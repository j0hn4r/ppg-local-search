const indexButton = document.getElementById('startIndexButton');
const statusDiv = document.getElementById('status');

indexButton.addEventListener('click', () => {
  statusDiv.textContent = 'Requesting indexing start...';
  indexButton.disabled = true; // Prevent double clicks

  // Send message to background script to start indexing
  chrome.runtime.sendMessage({ command: "startIndexing" }, (response) => {
    if (chrome.runtime.lastError) {
      statusDiv.textContent = `Error: ${chrome.runtime.lastError.message}`;
      indexButton.disabled = false;
    } else if (response && response.status) {
      statusDiv.textContent = response.status;
      // Keep button disabled if indexing started, re-enable on completion/error
      // (Relies on background script sending updates)
    } else {
      statusDiv.textContent = "No response from background.";
       indexButton.disabled = false;
    }
  });
});

// Listen for status updates from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "indexingStatus") {
    statusDiv.textContent = message.text;
    if (message.done) {
      indexButton.disabled = false; // Re-enable button when done
    } else {
      indexButton.disabled = true; // Keep disabled while in progress
    }
  }
});

// Optional: Check initial status when popup opens
chrome.runtime.sendMessage({ command: "getIndexStatus" }, (response) => {
   if (chrome.runtime.lastError) {
      statusDiv.textContent = `Error checking status: ${chrome.runtime.lastError.message}`;
   } else if (response && response.status) {
      statusDiv.textContent = response.status;
      indexButton.disabled = response.running || false;
   }
});

document.addEventListener('DOMContentLoaded', () => {
    // Fetch the index creation date from storage
    chrome.storage.local.get('indexCreationDate', (result) => {
        const indexDateElement = document.getElementById('index-date');
        if (result.indexCreationDate) {
            const date = new Date(result.indexCreationDate);
            const formattedDate = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear().toString().slice(-2)}`;
            indexDateElement.textContent = formattedDate; // Display the formatted date
        } else {
            indexDateElement.textContent = 'No index created yet.';
        }
    });
});