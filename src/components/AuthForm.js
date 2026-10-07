// Shared authentication form component
export class AuthForm extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.isLoginMode = true;
  }

  connectedCallback() {
    this.render();
    this.addEventListener('submit', this.handleSubmit.bind(this));
  }

  disconnectedCallback() {
    this.removeEventListener('submit', this.handleSubmit.bind(this));
  }

  setLoginMode(isLogin) {
    this.isLoginMode = isLogin;
    this.render();
  }

  render() {
    // Clear shadow root
    this.shadowRoot.innerHTML = '';

    // Create style element
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        max-width: 400px;
        width: 100%;
        padding: 20px;
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      input {
        padding: 12px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 16px;
      }
      button {
        padding: 12px;
        background-color: #007bff;
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 16px;
        cursor: pointer;
      }
      button:hover {
        background-color: #0056b3;
      }
      .toggle-form {
        margin-top: 16px;
        text-align: center;
        color: #007bff;
        cursor: pointer;
      }
      .toggle-form:hover {
        text-decoration: underline;
      }
      .error {
        color: #dc3545;
        font-size: 14px;
      }
      .success {
        color: #28a745;
        font-size: 14px;
      }
    `;
    this.shadowRoot.appendChild(style);

    // Create form
    const form = document.createElement('form');
    form.id = 'auth-form';

    // Create heading
    const heading = document.createElement('h2');
    heading.textContent = this.isLoginMode ? 'Sign In' : 'Sign Up';
    form.appendChild(heading);

    // Create email group
    const emailGroup = document.createElement('div');
    emailGroup.className = 'form-group';
    const emailLabel = document.createElement('label');
    emailLabel.htmlFor = 'email';
    emailLabel.textContent = 'Email';
    const emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.id = 'email';
    emailInput.required = true;
    emailInput.placeholder = 'Enter your email';
    emailGroup.appendChild(emailLabel);
    emailGroup.appendChild(emailInput);
    form.appendChild(emailGroup);

    // Create password group
    const passwordGroup = document.createElement('div');
    passwordGroup.className = 'form-group';
    const passwordLabel = document.createElement('label');
    passwordLabel.htmlFor = 'password';
    passwordLabel.textContent = 'Password';
    const passwordInput = document.createElement('input');
    passwordInput.type = 'password';
    passwordInput.id = 'password';
    passwordInput.required = true;
    passwordInput.placeholder = 'Enter your password';
    passwordGroup.appendChild(passwordLabel);
    passwordGroup.appendChild(passwordInput);
    form.appendChild(passwordGroup);

    // Create username group (only for signup)
    if (!this.isLoginMode) {
      const usernameGroup = document.createElement('div');
      usernameGroup.className = 'form-group';
      const usernameLabel = document.createElement('label');
      usernameLabel.htmlFor = 'username';
      usernameLabel.textContent = 'Username';
      const usernameInput = document.createElement('input');
      usernameInput.type = 'text';
      usernameInput.id = 'username';
      usernameInput.placeholder = 'Choose a username (optional)';
      usernameGroup.appendChild(usernameLabel);
      usernameGroup.appendChild(usernameInput);
      form.appendChild(usernameGroup);
    }

    // Create submit button
    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.textContent = this.isLoginMode ? 'Sign In' : 'Sign Up';
    form.appendChild(submitButton);

    // Create toggle form
    const toggleForm = document.createElement('div');
    toggleForm.className = 'toggle-form';
    toggleForm.textContent = this.isLoginMode ? 'Don\'t have an account? Sign Up' : 'Already have an account? Sign In';
    toggleForm.style.cursor = 'pointer';
    form.appendChild(toggleForm);

    // Create message div
    const messageDiv = document.createElement('div');
    messageDiv.id = 'message';
    messageDiv.className = 'message';
    form.appendChild(messageDiv);

    // Add form to shadow root
    this.shadowRoot.appendChild(form);

    // Add event listener to toggle form
    toggleForm.addEventListener('click', () => {
      this.setLoginMode(!this.isLoginMode);
    });
  }

  async handleSubmit(event) {
    event.preventDefault();

    const email = this.shadowRoot.getElementById('email').value.trim();
    const password = this.shadowRoot.getElementById('password').value.trim();
    const usernameInput = this.shadowRoot.getElementById('username');
    const username = usernameInput ? usernameInput.value.trim() : null;
    const messageDiv = this.shadowRoot.getElementById('message');

    // Clear previous messages
    messageDiv.textContent = '';
    messageDiv.className = 'message';

    try {
      if (this.isLoginMode) {
        await signIn(email, password);
        messageDiv.textContent = 'Signed in successfully!';
        messageDiv.className = 'message success';
      } else {
        const result = await signUp(email, password, username);
        if (result.user) {
          messageDiv.textContent = 'Account created successfully! Please check your email for confirmation.';
          messageDiv.className = 'message success';
        } else {
          messageDiv.textContent = 'Account created! Please check your email to confirm your account.';
          messageDiv.className = 'message success';
        }
      }

      // Clear form after successful submission
      event.target.reset();
    } catch (error) {
      messageDiv.textContent = error.message || 'An error occurred';
      messageDiv.className = 'message error';
    }
  }
}

// Define the custom element
customElements.define('auth-form', AuthForm);