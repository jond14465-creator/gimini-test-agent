"use strict";

function getTextSnippet(value, fallback = "Aucun extrait disponible.") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function getArray(value) {
  return Array.isArray(value) ? value : [];
}

function getObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function buildProviders(target, type) {
  const encoded = encodeURIComponent(target);
  const domain = type === "domain" ? target.replace(/^https?:\/\//i, "") : null;

  const providers = [
    {
      id: "github",
      label: "GitHub",
      type: "search",
      url: `https://api.github.com/search/repositories?q=${encoded}&per_page=5`,
      enabled: true,
      parse: (payload) =>
        getArray(payload.items).slice(0, 5).map((item) => ({
          title: item.full_name,
          snippet: item.description || "Aucune description fournie.",
          url: item.html_url,
        })),
    },
    {
      id: "github-users",
      label: "GitHub Users",
      type: "search",
      url: `https://api.github.com/search/users?q=${encoded}&per_page=5`,
      enabled: type !== "domain",
      parse: (payload) =>
        getArray(payload.items).slice(0, 5).map((item) => ({
          title: item.login,
          snippet: `Compte GitHub ${item.type || "User"}`,
          url: item.html_url,
        })),
    },
    {
      id: "wikipedia",
      label: "Wikipedia",
      type: "search",
      url: `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&format=json&origin=*`,
      enabled: true,
      parse: (payload) =>
        getArray(payload.query?.search).slice(0, 5).map((item) => ({
          title: item.title,
          snippet: getTextSnippet(item.snippet),
          url: `https://fr.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/\s+/g, "_"))}`,
        })),
    },
    {
      id: "hackernews",
      label: "Hacker News",
      type: "search",
      url: `https://hn.algolia.com/api/v1/search?query=${encoded}&hitsPerPage=5`,
      enabled: true,
      parse: (payload) =>
        getArray(payload.hits).slice(0, 5).map((item) => ({
          title: item.title || item.story_title || "Résultat Hacker News",
          snippet: item.story_text || item.comment_text || "Aucun extrait disponible.",
          url: item.url || `https://news.ycombinator.com/item?id=${item.objectID}`,
        })),
    },
    {
      id: "npm",
      label: "npm",
      type: "search",
      url: `https://registry.npmjs.org/-/v1/search?text=${encoded}&size=5`,
      enabled: type !== "domain",
      parse: (payload) =>
        getArray(payload.objects).slice(0, 5).map((item) => {
          const pkg = getObject(item.package);
          return {
            title: pkg.name || "Package npm",
            snippet: pkg.description || "Aucune description fournie.",
            url: pkg.links?.npm || `https://www.npmjs.com/package/${encodeURIComponent(pkg.name || "")}`,
          };
        }),
    },
  ];

  if (domain) {
    providers.unshift(
      {
        id: "dns",
        label: "Google DNS",
        type: "infrastructure",
        url: `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`,
        enabled: true,
        parse: (payload) =>
          getArray(payload.Answer).map((entry) => ({
            title: `${entry.name} → ${entry.data}`,
            snippet: `TTL ${entry.TTL} • type ${entry.type}`,
            url: `https://dns.google/query?name=${encodeURIComponent(domain)}`,
          })),
      },
      {
        id: "rdap",
        label: "RDAP",
        type: "infrastructure",
        url: `https://rdap.org/domain/${encodeURIComponent(domain)}`,
        enabled: true,
        parse: (payload) => {
          const entityHandles = getArray(payload.entities)
            .slice(0, 3)
            .map((entry) => entry.handle)
            .filter(Boolean);
          return [
            {
              title: payload.ldhName || domain,
              snippet:
                entityHandles.length > 0
                  ? `Entités RDAP: ${entityHandles.join(", ")}`
                  : "Aucune entité RDAP disponible.",
              url: `https://rdap.org/domain/${encodeURIComponent(domain)}`,
            },
          ];
        },
      },
      {
        id: "crtsh",
        label: "crt.sh",
        type: "infrastructure",
        url: `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`,
        enabled: true,
        parse: (payload) =>
          getArray(payload).slice(0, 5).map((entry) => ({
            title: entry.common_name || entry.name_value,
            snippet: `Certificat observé le ${entry.entry_timestamp}`,
            url: `https://crt.sh/?id=${entry.id}`,
          })),
      },
      {
        id: "wayback",
        label: "Wayback Machine",
        type: "archive",
        url: `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}/*&output=json&limit=6&fl=timestamp,original,statuscode`,
        enabled: true,
        parse: (payload) =>
          getArray(payload)
            .slice(1, 6)
            .map((entry) => ({
              title: entry[1] || domain,
              snippet: `Archive ${entry[0] || "inconnue"} • statut ${entry[2] || "n/a"}`,
              url: entry[1] || `https://web.archive.org/web/*/${domain}`,
            })),
      }
    );
  }

  return providers;
}

module.exports = {
  buildProviders,
};
