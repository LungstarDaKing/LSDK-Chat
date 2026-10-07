// Register page component
import { AuthForm } from '../components/AuthForm.js';
import { supabase } from '../utils/supabase.js';

export class RegisterPage extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  render() {
    // Clear shadow root
    this.shadowRoot.innerHTML = '';

    // Create container
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.justifyContent = 'center';
    container.style.alignItems = 'center';
    container.style.minHeight = '100vh';
    container.style.backgroundColor = '#f5f5f5';

    // Create auth card
    const card = document.createElement('div');
    card.style.backgroundColor = 'white';
    card.style.padding = '32px';
    card.style.borderRadius = '8px';
    card.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
    card.style.width = '100%';
    card.style.maxWidth = '400px';

    // Create logo/title
    const title = document.createElement('h1');
    title.textContent = 'LSDKChat';
    title.style.textAlign = 'center';
    title.style.marginBottom = '24px';
    title.style.color = '#333';

    // Create subtitle
    const subtitle = document.createElement('p');
    subtitle.textContent = 'Create your account';
    subtitle.style.textAlign = 'center';
    subtitle.style.marginBottom = '24px';
    subtitle.style.color = '#666';

    // Create auth form (in signup mode)
    const authForm = document.createElement('auth-form');
    authForm.setLoginMode(false); // Set to signup mode

    // Assemble card
    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(authForm);

    // Assemble container
    container.appendChild(card);

    // Add to shadow root
    this.shadowRoot.appendChild(container);
  }
}

// Define the custom element
customElements.define('register-page', RegisterPage);