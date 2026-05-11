import { render } from 'preact';
import { Root } from './ui/Root';
import { runCanary, waitForChatReady } from './gemini-dom';
import canaryCss from './styles/canary.css?inline';

const HOST_ID = 'inline-ui-root';

async function mount() {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = canaryCss;
  shadow.appendChild(style);

  const renderTarget = document.createElement('div');
  shadow.appendChild(renderTarget);

  const ready = await waitForChatReady();
  const canary = runCanary();
  if (ready.ok) {
    console.log('[InlineUI] canary:', canary);
  } else {
    console.warn('[InlineUI] canary timed out — still missing:', ready.missing, canary);
  }

  render(<Root canary={canary} />, renderTarget);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void mount(), { once: true });
} else {
  void mount();
}
