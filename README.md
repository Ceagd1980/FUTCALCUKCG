# Radar Fútbol (Football-Data)

Radar de fútbol con los datos públicos de Football-Data.co.uk (la página los ofrece para uso libre).
El servidor lee los resultados de la temporada y los próximos partidos y calcula: tabla general, de casa
y de fuera, 1X2 general y LL/VV, % ganador, PPG, goles cruzados, hándicap, % de Over 0.5–4.5, BTTS,
valla invicta, no marca, corners (8.5+/9.5+/10.5+), rachas, y la 🔥 por mercado con los mejores primero.

- `public/index.html` — la página
- `netlify/functions/fd.mjs` — `/api/fd?league=E0`, `/api/fd?part=leagues`, `/api/fd?debug=1&league=E0`
- `netlify.toml` — configuración de Netlify (no cambiar)

Publicar: repositorio nuevo en GitHub con todo junto (un solo commit) → Netlify → Import from GitHub → Deploy.
