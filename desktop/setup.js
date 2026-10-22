const api = window.slowTuneSetup;
let revealGeneration = 0;
async function confirmVisible(generation) {
  await Promise.all([...document.querySelectorAll('img')].filter(image => !image.hidden).map(image => image.decode().catch(() => {})));
  await document.fonts.ready;
  const animations = document.querySelector('.startup-stack').getAnimations();
  await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
  while (document.hidden && generation === revealGeneration) await new Promise(done => document.addEventListener('visibilitychange', done, { once: true }));
  await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  if (generation !== revealGeneration) return;
  performance.mark('slowtune:welcome-visible');
  api.ready();
}
function render(state) {
  document.documentElement.dataset.theme = state.theme;
  document.body.dataset.phase = state.phase;
  const settings = state.welcome?.settings;
  const background = document.querySelector('#background');
  background.hidden = settings?.background === 'plain' || !state.welcome?.image;
  document.body.dataset.artwork = String(!background.hidden);
  if (!background.hidden) background.src = state.welcome.image;
  background.style.objectPosition = `${settings?.desktopFocus?.x ?? 50}% ${settings?.desktopFocus?.y ?? 50}%`;
  document.querySelector('#shade').style.opacity = background.hidden ? '0' : String((settings?.shade ?? 22) / 100);
  document.querySelector('#status').textContent = state.message;
  document.querySelector('.startup-actions').hidden = state.phase !== 'error';
  document.querySelector('#retry').disabled = state.phase === 'starting';
  document.querySelector('#retry').textContent = state.retryLabel || '重试';
  const generation = ++revealGeneration;
  if (state.phase === 'starting') void confirmVisible(generation);
}
api.onState(render); void api.getState().then(render);
document.querySelector('#background').onerror = event => { event.target.hidden = true; document.body.dataset.artwork = 'false'; document.querySelector('#shade').style.opacity = '0'; };
document.querySelector('#retry').onclick = () => void api.retry();
document.querySelector('#quit').onclick = () => api.quit();
document.querySelector('#logs').onclick = () => void api.openLogs().catch(error => { document.querySelector('#status').textContent = error.message; });
document.querySelector('#data').onclick = () => void api.openData().catch(error => { document.querySelector('#status').textContent = error.message; });
