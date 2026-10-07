// Verify email page component (for magic link verification)
import { supabase } from '../utils/supabase.js';

export class VerifyEmailPage extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  async connectedCallback() {
    this.render();
    await this.handleVerification();
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

    // Create content
    const content = document.createElement('div');
    content.style.textAlign = 'center';
    content.style.padding = '32px';

    // Create spinner/icon
    const spinner = document.createElement('div');
    spinner.innerHTML = `
      <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="20" stroke="#007bff" stroke-width="4" fill="none" opacity="0.25"/>
        <path d="M24 8a16 16 0 0 1 0 32" stroke="#007bff" stroke-width="4" fill="none" stroke-linecap="round"/>
      </svg>
    `;
    spinner.style.marginBottom = '24px';

    // Create message
    const message = document.createElement('p');
    message.id = 'verify-message';
    message.textContent = 'Verifying your email...';
    message.style.fontSize = '18px';
    message.style.color = '#333';

    // Assemble content
    content.appendChild(spinner);
    content.appendChild(message);

    // Assemble container
    container.appendChild(content);

    // Add to shadow root
    this.shadowRoot.appendChild(container);
  }

  async handleVerification() {
    const messageDiv = this.shadowRoot.getElementById('verify-message');

    try {
      // Get token from URL hash (Supabase magic links use #access_token=...)
      const hash = window.location.hash;
      if (!hash) {
        throw new Error('No verification token found');
      }

      const token = hash.substring(1); // Remove the #

      // Verify the token with Supabase
      const { error } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: 'email'
      });

      if (error) {
        throw error;
      }

      // Verification successful
      messageDiv.textContent = 'Email verified successfully! Redirecting...';
      messageDiv.style.color = '#28a745';

      // Redirect to home after a short delay
      setTimeout(() => {
        window.location.href = '/';
      }, 1500);
    } catch (error) {
      messageDiv.textContent = 'Verification failed: ' + (error.message || 'Unknown error');
      messageDiv.style.color = '#dc3545';

      // Provide a link to try again or go to login
      const link = document.createElement('a');
      link.href = '/login';
      link.textContent = 'Go to login';
      link.style.display = 'block';
      link.style.marginTop = '16px';
      link.style.color = '#007bff';

      messageDiv.appendChild(link);
    }
  }
}

// Define the custom element
customElements.define('verify-email-page', VerifyEmailPage);