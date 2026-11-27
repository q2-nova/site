const links = Array.from(document.querySelectorAll(".frame"));
const dialog = document.querySelector("dialog");
const enlarged = document.getElementById("enlarged");
let selected = 0;

function showScreen(index) {
  selected = (index + links.length) % links.length;
  const link = links[selected];
  const figure = link.closest("figure");
  enlarged.src = link.href;
  enlarged.alt = link.querySelector("img").alt;
  document.getElementById("enlarged-title").textContent = figure.querySelector("h3").textContent;
  document.getElementById("description").textContent = figure.querySelector("p").textContent;
}

if (typeof dialog.showModal === "function") {
  links.forEach((link, index) => {
    link.addEventListener("click", (event) => {
      if (event.ctrlKey || event.shiftKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      showScreen(index);
      dialog.showModal();
      document.getElementById("close").focus();
    });
  });
  document.getElementById("close").addEventListener("click", () => dialog.close());
  document.getElementById("previous").addEventListener("click", () => showScreen(selected - 1));
  document.getElementById("next").addEventListener("click", () => showScreen(selected + 1));
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") showScreen(selected - 1);
    if (event.key === "ArrowRight") showScreen(selected + 1);
  });
}
