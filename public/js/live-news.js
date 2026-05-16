function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadLiveNews() {
  const target = document.getElementById("liveNews");
  if (!target) return;

  target.innerHTML = "<p>Loading market news links...</p>";

  try {
    const response = await fetch("/api/live-news");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load market news.");
    }

    const articles = Array.isArray(data.articles) ? data.articles : [];

    if (!articles.length) {
      target.innerHTML = "<p>No market news links available.</p>";
      return;
    }

    const grouped = articles.reduce((acc, article) => {
      const category = article.category || "Market news";
      if (!acc[category]) acc[category] = [];
      acc[category].push(article);
      return acc;
    }, {});

    target.innerHTML = Object.entries(grouped).map(([category, items]) => `
      <div class="news-category">
        <h3>${escapeHtml(category)}</h3>
        <div class="grid two news-card-grid">
          ${items.map(article => `
            <div class="card inner news-card">
              <h4>${escapeHtml(article.headline || "Untitled")}</h4>
              <p>${escapeHtml(article.summary || "")}</p>
              <small>${escapeHtml(article.source || "")}</small>
              <div style="margin-top:14px">
                <a class="button secondary" href="${escapeHtml(article.url || "#")}" target="_blank" rel="noopener noreferrer">
                  Open source
                </a>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error(err);
    target.innerHTML = `
      <div class="error">
        Could not load market news links. ${escapeHtml(err.message || "")}
      </div>
    `;
  }
}

document.addEventListener("DOMContentLoaded", loadLiveNews);
