// Preserve bookmarks from the original showcase navigation.
function followLegacyLink() {
  const { pathname, search, hash } = location;
  let target;
  let anchor = hash;
  if (pathname.endsWith("/features.html")) {
    target = "index.html";
  } else if (pathname.includes("/tour/")) {
    target = hash === "#firmware" ? "../index.html" : "../demo.html";
    if (hash === "#firmware") anchor = "#other-features";
  } else if (pathname.endsWith("/guide.html")) {
    target = { "#try": "install.html", "#simulator": "demo.html", "#studio-title": "demo.html" }[hash] || "index.html";
    if (["#try", "#simulator", "#studio-title", "#headline"].includes(hash)) anchor = "";
  } else if (["#playing", "#download", "#book", "#radio", "#sound", "#story"].includes(hash)) {
    target = "demo.html";
  }
  if (anchor === "#compare") {
    anchor = "#other-features";
    target ||= "index.html";
  }
  if (target) location.replace(target + search + anchor);
}
window.addEventListener("hashchange", followLegacyLink);
followLegacyLink();
