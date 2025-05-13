// background.js


let lunrLoaded = false;
try {
    importScripts('./js/lunr.min.js');
    if (typeof lunr !== 'undefined') {
        lunrLoaded = true;
    } else {
        console.error("BG: Lunr object is UNDEFINED after importScripts call."); // Log 4b
    }
} catch (e) {
    console.error("BG: FAILED to import lunr.js inside catch block:", e); // Log 5
}

const PPG_CONTENTS_URL = "https://www.gov.uk/government/collections/planning-practice-guidance";
const STORAGE_KEY_INDEX = 'ppgLunrIndex';
const STORAGE_KEY_DOCS = 'ppgDocumentsMap';
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

let isIndexing = false;
let indexingStatus = "Ready.";
let creatingOffscreenDocument = null;

// --- Offscreen Document Management ---
async function hasOffscreenDocument(path = OFFSCREEN_DOCUMENT_PATH) {
    const offscreenUrl = chrome.runtime.getURL(path);
    const matchedClients = await clients.matchAll();
    let found = false;
    for (const client of matchedClients) {
        if (client.url === offscreenUrl) {
            found = true;
            break;
        }
    }
    return found;
}

async function setupOffscreenDocument(path = OFFSCREEN_DOCUMENT_PATH) {
  if (creatingOffscreenDocument) {
      await creatingOffscreenDocument;
  } else if (!(await hasOffscreenDocument(path))) {
      creatingOffscreenDocument = chrome.offscreen.createDocument({
          url: chrome.runtime.getURL(path),
          reasons: ['DOM_PARSER'],
          justification: 'Need DOMParser API to parse fetched HTML content for indexing.'
      });
      try {
            await creatingOffscreenDocument;
      } catch(creationError) {
            console.error("BG: ERROR creating offscreen document:", creationError);
            creatingOffscreenDocument = null;
            throw creationError;
      } finally {
           creatingOffscreenDocument = null;
      }
  } else {
  }
}

// --- Parsing via Offscreen Document ---
async function parseHtmlViaOffscreen(htmlString, task) {
    await setupOffscreenDocument();

    try {
        const response = await chrome.runtime.sendMessage({
            type: 'parse-html',
            target: 'offscreen',
            htmlString: htmlString,
            task: task
        });

        if (!response) {
             console.error("BG: Offscreen document did not respond.");
             throw new Error("Offscreen document did not respond.");
        }
        if (response.success) {
            return response.data;
        } else {
            console.error(`BG: Offscreen parsing failed: ${response.error || 'Unknown error'}`);
            throw new Error(`Offscreen parsing failed: ${response.error || 'Unknown error'}`);
        }
    } catch (error) {
         console.error(`BG: ERROR during sendMessage for task '${task}':`, error);
         if (error.message.includes("Could not establish connection") || error.message.includes("message port closed")) {
             console.warn("BG: Connection error suggests offscreen document might have closed or crashed.");
         }
         throw error;
    }
}

// --- Main Indexing Function ---
async function startIndexingProcess() {

    if (isIndexing) { return; }
    if (!lunrLoaded) {
        console.error("BG: Lunr library not loaded, cannot start indexing.");
        updateStatus("Error: Lunr library missing.", true);
        return;
    }

    isIndexing = true;
    updateStatus("Starting: Fetching contents page...", false);

    const baseUrl = new URL(PPG_CONTENTS_URL).origin;

    try {
        const response = await fetch(PPG_CONTENTS_URL);
        if (!response.ok) throw new Error(`Failed to fetch contents page: ${response.statusText}`);
        const html = await response.text();

        updateStatus("Parsing contents page for links...", false);

        const relativeLinks = await parseHtmlViaOffscreen(html, 'extract-links');
        // Log only a sample if the array is large


        if (!relativeLinks || !Array.isArray(relativeLinks) || relativeLinks.length === 0) {
             throw new Error("Could not extract valid relative guidance links array using offscreen document.");
        }

        // *** Construct Absolute URLs - REVISED LOGGING AND HANDLING ***
        const absoluteGuidanceLinks = [];
        for (const relPath of relativeLinks) {
            if (typeof relPath === 'string' && relPath.startsWith('/')) {
                try {
                    const fullUrl = new URL(relPath, baseUrl).href;
                    absoluteGuidanceLinks.push(fullUrl);
                } catch (urlError) {
                    console.warn(`BG: ERROR constructing absolute URL for path "${relPath}" with base "${baseUrl}":`, urlError);
                    // Do not push null or undefined, just skip
                }
            } else {
                console.warn(`BG: Invalid relPath encountered: "${relPath}" (Type: ${typeof relPath}) - Skipping.`);
            }
        }

        updateStatus(`Found ${absoluteGuidanceLinks.length} links. Fetching pages...`, false);

        if (absoluteGuidanceLinks.length === 0 && relativeLinks.length > 0) { // If we had relative links but couldn't make any absolute
            throw new Error("No valid absolute guidance links could be constructed from relative paths.");
        }
        if (absoluteGuidanceLinks.length === 0) { // General case if no links at all
             throw new Error("No guidance links found or constructed.");
        }


        // 3. Fetch and parse each guidance page
        const documents = [];
        let fetchedCount = 0;
        const totalLinks = absoluteGuidanceLinks.length;

        for (const url of absoluteGuidanceLinks) {
            try {
                const pageResponse = await fetch(url);
                if (!pageResponse.ok) {
                    console.warn(`Skipping ${url}: ${pageResponse.statusText}`);
                    fetchedCount++;
                    updateStatus(`Skipping ${fetchedCount}/${totalLinks}: ${url.substring(url.lastIndexOf('/') + 1)}`, false);
                    continue;
                 }
                const pageHtml = await pageResponse.text();
                const parsedContent = await parseHtmlViaOffscreen(pageHtml, 'extract-content');

                if (parsedContent && parsedContent.title && parsedContent.body) {
                    documents.push({ id: url, title: parsedContent.title, body: parsedContent.body });
                } else if (parsedContent) {
                     console.warn(`BG: Skipping ${url}: Extracted partial content (Title: ${!!parsedContent.title}, Body: ${!!parsedContent.body})`);
                } else {
                     console.warn(`BG: Skipping ${url}: Offscreen document returned no content for ${url}.`);
                }

                fetchedCount++;
                updateStatus(`Processing ${fetchedCount}/${totalLinks}: ${url.substring(url.lastIndexOf('/') + 1)}`, false);
            } catch (pageError) {
                 console.error(`BG: Error processing page ${url}:`, pageError);
                 fetchedCount++;
                 updateStatus(`Error on ${fetchedCount}/${totalLinks}: ${url.substring(url.lastIndexOf('/') + 1)}`, false);
                 if (pageError.message.includes("Connection to offscreen lost") || pageError.message.includes("message port closed")) {
                    throw new Error("Lost connection to offscreen document during page processing. Aborting.");
                 }
            }
        } // End for loop

        if (!Array.isArray(documents)) {
            console.error("BG: ERROR - 'documents' is NOT an array before indexing!");
        } else if (documents.some(doc => !doc || typeof doc.id === 'undefined' || typeof doc.title === 'undefined' || typeof doc.body === 'undefined')) {
            console.error("BG: ERROR - Some documents are missing id, title, or body before indexing!");
            documents.forEach((doc, index) => {
                if (!doc || typeof doc.id === 'undefined' || typeof doc.title === 'undefined' || typeof doc.body === 'undefined') {
                }
            });
        }

        if (documents.length === 0) {
             throw new Error("No documents could be successfully processed for indexing body/title.");
        }

        updateStatus(`Building index for ${documents.length} documents...`, false);

        const idx = lunr(function () {
             this.ref('id');
             this.field('title', { boost: 10 });
             this.field('body');
             this.metadataWhitelist = ['position'];
             documents.forEach(doc => this.add(doc));
         });

         const documentsMap = {};
         documents.forEach(doc => { documentsMap[doc.id] = { title: doc.title }; });
         await chrome.storage.local.set({
             [STORAGE_KEY_INDEX]: JSON.stringify(idx),
             [STORAGE_KEY_DOCS]: documentsMap
         });
        updateStatus(`Indexing complete (${documents.length} docs). Ready.`, true);

    } catch (error) {
        console.error("BG: Indexing failed:", error);
        console.error("BG: Error Stack:", error.stack);
        updateStatus(`Error: ${error.message}`, true);
    } finally {
        isIndexing = false;
        try {
            if (await hasOffscreenDocument()) {
                await chrome.offscreen.closeDocument();
            } else {
            }
        } catch (closeError) {
             console.warn("BG: Error closing offscreen document:", closeError);
        }
    }
}

// --- Utility Functions ---
function updateStatus(text, done) {
    indexingStatus = text;
    chrome.runtime.sendMessage({ type: "indexingStatus", text: text, done: done }).catch(e => {
        if (!e.message.includes("Receiving end does not exist")) console.warn("BG: Error sending status update:", e);
    });
    chrome.action.setBadgeText({ text: done ? '' : 'IDX' });
    chrome.action.setBadgeBackgroundColor({ color: '#FFA500' });
}

// --- Event Listeners ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
     if (message.command === "startIndexing") {
        startIndexingProcess(); // Keep this as non-awaited to respond to popup quickly
        sendResponse({ status: "Indexing requested..." });
        return true; // Indicates async response for the message handler
    }
    else if (message.command === "getIndexStatus") {
        sendResponse({ status: indexingStatus, running: isIndexing });
        return false; // Synchronous response
    }
});

chrome.runtime.onStartup.addListener(() => { chrome.action.setBadgeText({ text: '' }); });

// --- Initial Status Check & Script End ---
chrome.storage.local.get([STORAGE_KEY_INDEX], (result) => {
    if (chrome.runtime.lastError) {
        console.warn("BG: Error checking initial storage:", chrome.runtime.lastError);
        updateStatus("Error checking storage.", true);
    } else if(result[STORAGE_KEY_INDEX]) {
        updateStatus("Index loaded from storage. Ready.", true);
    } else {
         updateStatus("Index not built yet.", true);
    }
});

if (!lunrLoaded) {
    console.error("BG: Lunr object is undefined at end of script load (after storage check)."); // Log 8
    if (indexingStatus === "Ready.") { // Only update if no other error set it
         updateStatus("Error: Lunr library missing.", true);
    }
} else {
}