async function loadLiveNews() {
  const target = document.getElementById("liveNews");

  if (!target) return;

  target.innerHTML = "<p>Loading live market news...</p>";

  try {
    const response = await fetch("/api/live-news");
    const data = await response.json();

    target.innerHTML = "";

    (data.articles || []).forEach(article => {
      const card = document.createElement("div");

      card.className = "card";
      card.style.marginBottom = "16px";

      card.innerHTML = `
        <h3>${article.headline || "Untitled"}</h3>

        <p>${article.summary || ""}</p>

        <small>
          ${article.source || ""}
        </small>

        <br><br>

        <a class="button secondary"
           href="${article.url}"
           target="_blank">
          Open Article
        </a>
      `;

      target.appendChild(card);
    });

  } catch (err) {
    console.error(err);

    target.innerHTML = `
      <div class="error">
        Could not load live market news.
      </div>
    `;
  }
}

document.addEventListener("DOMContentLoaded", loadLiveNews);
