// The install page's Copy buttons. A file, not an inline script, so the Content-Security-Policy keeps
// script-src to 'self' (scripts/security-headers.ts).
for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    const text = button.previousElementSibling.textContent.replace(/\s+/g, " ").trim();
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select and copy";
    }
    setTimeout(() => (button.textContent = "Copy"), 2000);
  });
}
