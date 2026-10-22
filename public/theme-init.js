(() => {
  let preference = 'system';
  let palette = 'paper';
  const backgrounds = { light: '#F3F0E9', dark: '#1B1916' };
  const palettes = ['paper', 'mint', 'ocean', 'plum'];
  try {
    const saved = localStorage.getItem('slow-listening:theme:v1');
    if (saved === 'light' || saved === 'dark') preference = saved;
    const savedPalette = localStorage.getItem('slow-listening:palette:v1');
    if (palettes.includes(savedPalette)) palette = savedPalette;
  } catch {}
  const hour = new Date().getHours();
  const theme = preference === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches || hour < 6 || hour >= 18 ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.palette = palette;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', backgrounds[theme]);
})();
