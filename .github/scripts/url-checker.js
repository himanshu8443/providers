const fs = require("fs");
const axios = require("axios");
const path = require("path");

const FILE_PATH = "modflix.json";

// Read the modflix.json file
async function readModflixJson() {
  try {
    const data = fs.readFileSync(FILE_PATH, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${FILE_PATH}:`, error);
    process.exit(1);
  }
}

// Extract domain from URL
function getDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.origin;
  } catch (error) {
    console.error(`Error parsing URL ${url}:`, error);
    return url;
  }
}

// Extract path from URL
function getPath(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname + urlObj.search + urlObj.hash;
  } catch (error) {
    console.error(`Error extracting path from ${url}:`, error);
    return "";
  }
}

// Check URL and return new URL if redirected
async function checkUrl(url) {
  try {
    const response = await axios.get(url, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    // If status is 200, no change needed
    if (response.status === 200) {
      console.log(`✅ ${url} is valid (200 OK)`);
      return null;
    }
  } catch (error) {
    // Handle redirects
    if (
      error.response &&
      (error.response.status === 301 ||
        error.response.status === 302 ||
        error.response.status === 307 ||
        error.response.status === 308)
    ) {
      const newLocation = error.response.headers.location;
      if (newLocation) {
        // If it's a relative redirect, construct the full URL
        let fullRedirectUrl = newLocation;
        if (!newLocation.startsWith("http")) {
          const baseUrl = new URL(url);
          fullRedirectUrl = new URL(newLocation, baseUrl.origin).toString();
        }

        console.log(`🔄 ${url} redirects to ${fullRedirectUrl}`);

        // Get new domain but keep original path
        const newDomain = getDomain(fullRedirectUrl);
        const originalPath = getPath(url);

        // Construct new URL with original path
        let finalUrl = newDomain;
        if (originalPath && originalPath !== "/") {
          finalUrl += originalPath;
        }

        return finalUrl;
      }
    } else if (error.response) {
      console.log(`⚠️ ${url} returned status ${error.response.status}`);
    } else if (error.request) {
      console.log(`❌ ${url} failed to respond`);
    } else {
      console.log(`❌ Error checking ${url}: ${error.message}`);
    }
  }

  // Return null if no change or error
  return null;
}

// Main function
async function main() {
  const providers = await readModflixJson();
  let hasChanges = false;

  // Process each provider
  for (const [key, provider] of Object.entries(providers)) {
    const url = provider.url;
    console.log(`Checking ${provider.name} (${url})...`);

    const newUrl = await checkUrl(url);
    if (newUrl && newUrl !== url) {
      provider.url = newUrl;
      hasChanges = true;
      console.log(`Updated ${provider.name} URL to ${newUrl}`);
    }
  }

  // Write changes back to file if needed
  if (hasChanges) {
    fs.writeFileSync(FILE_PATH, JSON.stringify(providers, null, 2));
    console.log(`Updated ${FILE_PATH} with new URLs`);
  } else {
    console.log(`No changes needed for ${FILE_PATH}`);
  }
}

// Execute main function
main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
