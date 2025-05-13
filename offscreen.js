// offscreen.js


chrome.runtime.onMessage.addListener(handleMessages);

function handleMessages(message, sender, sendResponse) {

  if (message.target !== 'offscreen') {
    return false;
  }

  switch (message.type) {
    case 'parse-html':
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(message.htmlString, 'text/html');
        let result = null;

        if (message.task === 'extract-links') {
          // This part seems to be working correctly.
          const linkElements = doc.querySelectorAll('.gem-c-document-list .gem-c-document-list__item-title a');
          result = Array.from(linkElements)
                        .map(a => a.getAttribute('href'))
                        .filter(href => href && href.startsWith('/guidance/'));

        } else if (message.task === 'extract-content') {
           // Title extraction - usually h1 is reliable on GOV.UK content pages
           let titleElement = doc.querySelector('h1.govuk-heading-xl'); // More specific H1
           if (!titleElement) {
               titleElement = doc.querySelector('h1'); // Fallback to any H1
           }
           const title = titleElement ? titleElement.textContent.trim() : doc.title.trim();

           // Body content extraction - CRUCIAL PART
           // Try a common GOV.UK main content wrapper first
           let mainContentWrapper = doc.querySelector('.gem-c-govspeak'); // This often wraps the core content
           if (!mainContentWrapper) {
               // Fallback: sometimes content is directly in a <main> tag or older structures
               mainContentWrapper = doc.querySelector('main#content div.govspeak') || doc.querySelector('main#content') || doc.querySelector('main');
           }


           let body = '';
           if (mainContentWrapper) {
                // Get all text content from this wrapper and its children
                // We want to avoid picking up navigation or related links if they are inside
                // A simple approach is to get all <p>, <li>, <h2>, <h3> etc.
                // More robustly, just get textContent of the main wrapper, but clean it.

                // Let's try taking all text from the main wrapper, then clean it.
                // This might be too broad if there's a lot of non-body text inside mainContentWrapper.
                // A more targeted approach would be to select specific child elements.

                // Option 1: Get all text from the wrapper (simpler but potentially noisy)
                // body = mainContentWrapper.textContent.trim();

                // Option 2: Iterate through known content-bearing elements within the wrapper
                const contentBearingElements = mainContentWrapper.querySelectorAll('p, h2, h3, h4, h5, h6, ul, ol, table');
                if (contentBearingElements.length > 0) {
                    contentBearingElements.forEach(el => {
                        body += el.textContent.trim() + '\n\n'; // Add space between elements
                    });
                } else {
                    // Fallback if no specific content elements, take all text from wrapper
                    console.warn("Offscreen: No specific content-bearing elements found, taking all text from wrapper.");
                    body = mainContentWrapper.textContent.trim();
                }

           } else {
               console.warn("Offscreen: Could not find a main content wrapper. Attempting doc.body fallback.");
               body = doc.body ? doc.body.textContent.trim() : ''; // Last resort
           }

           // Clean up the extracted body text
           body = body.replace(/[\s\n]+/g, ' ').trim(); // Replace multiple spaces/newlines with single space

           if (title || body) { // We need at least one of them
                result = {
                    title: title || '', // Ensure always string, even if empty
                    body: body || ''    // Ensure always string, even if empty
                };
           } else {
               result = null; // This is what results in the empty {} in background.js
               console.warn(`Offscreen could not extract title OR body for a page.`);
           }
        }

        sendResponse({ success: true, data: result }); // result can be {title, body} or null

      } catch (error) {
        console.error('Offscreen parsing/processing error:', error);
        console.error('Error stack:', error.stack);
        sendResponse({ success: false, error: error.message });
      }
      return true;

    default:
      console.warn(`Offscreen received unknown message type: ${message.type}`);
      return false;
  }
}