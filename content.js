// content.js

const STORAGE_KEY_INDEX = 'ppgLunrIndex';
const STORAGE_KEY_DOCS = 'ppgDocumentsMap';


let ppgLunrIndex = null;
let ppgDocumentsMap = null;

const SEARCH_CONTAINER_ID = 'ppg-local-search-container';
const SEARCH_INPUT_ID = 'ppg-local-search-input';
const RESULTS_DIV_ID = 'ppg-local-search-results';
const STATUS_DIV_ID = 'ppg-local-search-status';

function injectSearchUI() {
    if (document.getElementById(SEARCH_CONTAINER_ID)) {
        return;
    }

    const targetHeading = document.getElementById('planning-practice-guidance-categories');
    if (!targetHeading) {
        console.error("CONTENT.JS: Target heading 'planning-practice-guidance-categories' not found for UI injection."); // Log 2b
        return;
    }

    const container = document.createElement('div');
    container.id = SEARCH_CONTAINER_ID;
    container.className = 'ppg-search-widget';

    const label = document.createElement('label');
    label.htmlFor = SEARCH_INPUT_ID;
    label.textContent = 'Search the PPG:';

    const searchWrapper = document.createElement('div');
    searchWrapper.style.position = 'relative';

    const input = document.createElement('input');
    input.type = 'search';
    input.id = SEARCH_INPUT_ID;
    input.placeholder = 'Search guidance...';
    input.disabled = true;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.style.position = 'absolute';
    svg.style.right = '14px';
    svg.style.top = '50%';
    svg.style.transform = 'translateY(-50%)';
    svg.style.width = '18px';
    svg.style.height = '18px';
    svg.style.fill = '#b1b4b6';
    svg.style.pointerEvents = 'none';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l4.25 4.25c.41.41 1.09.41 1.5 0s.41-1.09 0-1.5l-4.25-4.25zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z');
    svg.appendChild(path);

    searchWrapper.appendChild(input);
    searchWrapper.appendChild(svg);

    const statusDiv = document.createElement('div');
    statusDiv.id = STATUS_DIV_ID;
    statusDiv.textContent = 'Initializing...';

    const resultsDiv = document.createElement('div');
    resultsDiv.id = RESULTS_DIV_ID;

    container.appendChild(label);
    container.appendChild(searchWrapper);
    container.appendChild(statusDiv);
    container.appendChild(resultsDiv);

    targetHeading.parentNode.insertBefore(container, targetHeading);

    // Add event listener for search input
    input.addEventListener('input', handleSearchInput);
}

function updateStatus(message) {
    const statusDiv = document.getElementById(STATUS_DIV_ID);
    if (statusDiv) {
        statusDiv.textContent = message;
    } else {
        console.warn("CONTENT.JS: Status div not found to update."); // Log 5a
    }
}

function loadIndexFromStorage() {
    updateStatus("Loading index from storage...");
    chrome.storage.local.get([STORAGE_KEY_INDEX, STORAGE_KEY_DOCS], (result) => {
        const searchInput = document.getElementById(SEARCH_INPUT_ID);

        if (chrome.runtime.lastError) {
             console.error("CONTENT.JS: Error loading index from storage:", chrome.runtime.lastError); // Log 7a
             updateStatus("Error loading index.");
             if(searchInput) searchInput.placeholder = "Error loading index";
             return;
        }

        if (result && result[STORAGE_KEY_INDEX] && result[STORAGE_KEY_DOCS]) {
            try {
                const serialisedIndex = result[STORAGE_KEY_INDEX];
                ppgDocumentsMap = result[STORAGE_KEY_DOCS];
                ppgLunrIndex = lunr.Index.load(JSON.parse(serialisedIndex));

                updateStatus(`Index ready (${Object.keys(ppgDocumentsMap || {}).length} docs).`); // Added || {} for safety

                if (searchInput) {
                    searchInput.disabled = false;
                    searchInput.placeholder = 'Search guidance...';
                } else {
                    console.warn("CONTENT.JS: Search input not found after loading index."); // Log 11a
                }
            } catch (e) {
                console.error("CONTENT.JS: Error parsing or loading Lunr index from storage:", e); // Log 12
                updateStatus("Error loading index data.");
                 if(searchInput) searchInput.placeholder = "Failed to load index";
            }
        } else {
            console.warn("CONTENT.JS: Index or docs not found in storage result."); // Log 13
            console.warn("CONTENT.JS: result[STORAGE_KEY_INDEX] exists?", !!result[STORAGE_KEY_INDEX]);
            console.warn("CONTENT.JS: result[STORAGE_KEY_DOCS] exists?", !!result[STORAGE_KEY_DOCS]);
            updateStatus("Index not built. Use extension popup to build.");
             if(searchInput) searchInput.placeholder = "Index not built yet";
        }
    });
}

function handleSearchInput(event) {
    const rawQuery = event.target.value.trim();
    const resultsDiv = document.getElementById(RESULTS_DIV_ID);

    if (!resultsDiv) {
        console.error("CONTENT.JS: Results div not found in handleSearchInput."); // Log 14a
        return;
    }
    resultsDiv.innerHTML = '';

    if (!ppgLunrIndex) {
        console.warn("CONTENT.JS: ppgLunrIndex is null in handleSearchInput. Aborting search."); // Log 15
        resultsDiv.textContent = 'Index not loaded or still loading.';
        return;
    }

    if (rawQuery.length < 3) {
        return;
    }

    try {
        let searchResults;
        const queryTerms = rawQuery.toLowerCase().split(/\s+/).filter(term => term.length > 0);

        if (queryTerms.length > 1) {
            const phraseQuery = `"${rawQuery}"^100 title:"${rawQuery}"^50 body:"${rawQuery}" ${queryTerms.join(' ')}`;
            searchResults = ppgLunrIndex.search(phraseQuery);
        } else {
            searchResults = ppgLunrIndex.search(rawQuery);
        }

        if (searchResults.length === 0) {
            resultsDiv.textContent = 'No matches found.';
        } else {
            const ul = document.createElement('ul');
            searchResults.slice(0, 20).forEach(result => {
                const docRef = result.ref;
                const docInfo = ppgDocumentsMap ? ppgDocumentsMap[docRef] : null; // Check ppgDocumentsMap
                const title = docInfo ? docInfo.title : docRef;

                const li = document.createElement('li');
                const a = document.createElement('a');
                a.href = docRef;
                a.textContent = title;
                a.target = '_blank';

                const scoreSpan = document.createElement('span');
                scoreSpan.textContent = ` (Score: ${result.score.toFixed(2)})`;
                scoreSpan.style.fontSize = '0.8em';
                scoreSpan.style.marginLeft = '5px';
                scoreSpan.style.color = '#777';

                li.appendChild(a);
                li.appendChild(scoreSpan);
                ul.appendChild(li);
            });
            resultsDiv.appendChild(ul);
        }
    } catch (e) {
        console.error("CONTENT.JS: Error during search execution:", e); // Log 20
        resultsDiv.textContent = 'Error during search execution.';
    }
}

// --- Main Execution ---
injectSearchUI();
loadIndexFromStorage();