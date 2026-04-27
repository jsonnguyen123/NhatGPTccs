document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('issue-form');
    const successMessage = document.getElementById('success-message');
    const submitButton = document.getElementById('submit-issue');
    const submitAnother = document.getElementById('submit-another');
    const submittedEmail = document.getElementById('submitted-email');
    const issueTypeError = document.getElementById('issue-type-error');
    const issueTypeContainer = document.getElementById('issue-type-container');

    // ✅ NO MORE HARDCODED CREDENTIALS - everything goes through the backend

    // Create loading overlay
    const loadingOverlay = document.createElement('div');
    loadingOverlay.id = 'loading-overlay';
    loadingOverlay.className = 'loading-overlay';
    loadingOverlay.innerHTML = `
        <div class="loading-content">
            <div class="loading-spinner"></div>
            <p class="loading-text">Submitting your report...</p>
        </div>
    `;
    document.body.appendChild(loadingOverlay);

    // Initialize
    addButtonAnimations();
    setupValidationListeners();
    detectSystemInfo();
    autoFillUserFromCanvas();

    // ========== AUTO-FILL FROM CANVAS ==========

    async function autoFillUserFromCanvas() {
        const nameField = document.getElementById('user-name');
        const emailField = document.getElementById('user-email');
        if (!nameField || !emailField) return;

        nameField.placeholder = 'Loading from Canvas...';
        emailField.placeholder = 'Loading from Canvas...';

        try {
            const profile = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(
                    { type: 'MAKE_CANVAS_API_REQUEST', endpoint: '/users/self/profile' },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else if (response && response.success) {
                            resolve(response.data);
                        } else {
                            reject(new Error(response?.error || 'Failed to fetch profile'));
                        }
                    }
                );
            });

            if (profile.name) {
                nameField.value = profile.name;
                nameField.readOnly = true;
                nameField.style.opacity = '0.8';
                nameField.style.cursor = 'not-allowed';
                addBadge(nameField);
            }

            const email = profile.primary_email || profile.login_id || profile.email;
            if (email) {
                emailField.value = email;
                emailField.readOnly = true;
                emailField.style.opacity = '0.8';
                emailField.style.cursor = 'not-allowed';
                addBadge(emailField);
            } else {
                emailField.placeholder = 'your.email@school.org';
            }
        } catch (err) {
            console.warn('Could not auto-fill from Canvas:', err.message);
            nameField.placeholder = 'John Doe';
            emailField.placeholder = 'your.email@school.org';
        }
    }

    function addBadge(field) {
        const wrapper = field.closest('.form-group');
        if (!wrapper || wrapper.querySelector('.auto-fill-badge')) return;
        const badge = document.createElement('span');
        badge.className = 'auto-fill-badge';
        badge.textContent = ' 🔒 Auto-filled from Canvas';
        const label = wrapper.querySelector('.form-label');
        if (label) label.appendChild(badge);
    }

    // ========== VALIDATION ==========

    function setupValidationListeners() {
        form.querySelectorAll('input[type="text"], input[type="email"], textarea').forEach(field => {
            field.addEventListener('input', () => {
                field.classList.remove('invalid');
            });
        });

        form.querySelectorAll('input[name="issue-type"]').forEach(radio => {
            radio.addEventListener('change', () => {
                if (issueTypeError) issueTypeError.classList.remove('show');
                if (issueTypeContainer) issueTypeContainer.classList.remove('invalid');

                document.querySelectorAll('.issue-type-option .option-content').forEach(opt => {
                    opt.classList.remove('selected');
                });
                if (radio.checked && radio.parentElement) {
                    const content = radio.parentElement.querySelector('.option-content');
                    if (content) {
                        content.classList.add('selected');
                        content.classList.add('selected-animate');
                        setTimeout(() => content.classList.remove('selected-animate'), 300);
                    }
                }
            });
        });
    }

    function validateForm() {
        let isValid = true;
        const errors = [];

        const issueTypeSelected = form.querySelector('input[name="issue-type"]:checked');
        if (!issueTypeSelected) {
            if (issueTypeError) issueTypeError.classList.add('show');
            if (issueTypeContainer) issueTypeContainer.classList.add('invalid');
            errors.push(issueTypeContainer);
            isValid = false;
        }

        const requiredFields = [
            { id: 'user-name', label: 'Name' },
            { id: 'user-email', label: 'Email' },
            { id: 'issue-title', label: 'Brief Description' },
            { id: 'issue-description', label: 'Detailed Description' }
        ];

        requiredFields.forEach(({ id }) => {
            const field = document.getElementById(id);
            if (field && !field.value.trim()) {
                field.classList.add('invalid');
                errors.push(field);
                isValid = false;
            }
        });

        const emailField = document.getElementById('user-email');
        if (emailField && emailField.value.trim()) {
            const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailPattern.test(emailField.value.trim())) {
                emailField.classList.add('invalid');
                if (!errors.includes(emailField)) errors.push(emailField);
                isValid = false;
            }
        }

        if (errors.length > 0 && errors[0]) {
            errors[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        return isValid;
    }

    // ========== FORM SUBMISSION (NOW ROUTES THROUGH BACKEND) ==========

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!validateForm()) {
            showNotification('warning', 'Missing Information', 'Please fill in all required fields.');
            shakeButton(submitButton);
            return;
        }

        loadingOverlay.classList.add('show');
        animateButtonToLoading(submitButton);

        const formData = new FormData(form);

        const reportData = {
            user_name: formData.get('user-name'),
            user_email: formData.get('user-email'),
            issue_type: formData.get('issue-type'),
            issue_title: formData.get('issue-title'),
            description: formData.get('issue-description'),
            steps_to_reproduce: formData.get('steps-to-reproduce') || 'Not provided',
            browser: formData.get('browser') || 'Not specified',
            os: formData.get('os') || 'Not specified',
            tried_refresh: formData.get('tried-refresh') === 'yes' ? 'Yes' : 'No',
            tried_restart: formData.get('tried-restart') === 'yes' ? 'Yes' : 'No',
            tried_reinstall: formData.get('tried-reinstall') === 'yes' ? 'Yes' : 'No',
            tried_docs: formData.get('tried-docs') === 'yes' ? 'Yes' : 'No',
            additional_info: formData.get('additional-info') || 'None provided',
            extension_version: getExtensionVersion(),
            timestamp: new Date().toLocaleString()
        };

        try {
            // ✅ Send through background.js → backend server → EmailJS
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(
                    { type: 'SUBMIT_ISSUE_REPORT', data: reportData },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve(response);
                        }
                    }
                );
            });

            loadingOverlay.classList.remove('show');

            if (response && response.success) {
                showSuccessAnimation();

                setTimeout(() => {
                    form.style.display = 'none';
                    successMessage.style.display = 'block';
                    successMessage.classList.add('fade-in');
                    if (submittedEmail) {
                        submittedEmail.textContent = formData.get('user-email');
                    }
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }, 1800);

                showNotification('success', 'Report Sent!', 'Your issue report has been submitted successfully.');
            } else {
                throw new Error(response?.error || 'Submission failed');
            }
        } catch (error) {
            console.error('📧 Submission failed:', error);

            loadingOverlay.classList.remove('show');
            animateButtonToNormal(submitButton);

            showNotification('error', 'Submission Failed', error.message || 'Unable to send report.');

            setTimeout(() => {
                if (confirm('Would you like to send the report via email instead?')) {
                    openMailtoFallback(reportData);
                }
            }, 500);
        }
    });

    // ========== BUTTON ANIMATIONS ==========

    function addButtonAnimations() {
        if (!submitButton) return;
        submitButton.addEventListener('mousedown', createRipple);
        submitButton.classList.add('btn-animated');
    }

    function createRipple(event) {
        const button = event.currentTarget;
        const ripple = document.createElement('span');
        const rect = button.getBoundingClientRect();

        const size = Math.max(rect.width, rect.height);
        const x = event.clientX - rect.left - size / 2;
        const y = event.clientY - rect.top - size / 2;

        ripple.className = 'btn-ripple';
        ripple.style.cssText = `
            position: absolute;
            width: ${size}px;
            height: ${size}px;
            left: ${x}px;
            top: ${y}px;
            background: rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            transform: scale(0);
            animation: ripple-animation 0.6s ease-out;
            pointer-events: none;
        `;

        button.style.position = 'relative';
        button.style.overflow = 'hidden';
        button.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
    }

    function animateButtonToLoading(button) {
        if (!button) return;
        button.disabled = true;
        button.classList.add('btn-loading');
        button.innerHTML = `
            <span class="btn-spinner"></span>
            <span class="btn-text">Sending...</span>
        `;
    }

    function animateButtonToNormal(button) {
        if (!button) return;
        button.disabled = false;
        button.classList.remove('btn-loading');
        button.innerHTML = '<span class="btn-icon">📨</span> Submit Issue Report';
    }

    function shakeButton(button) {
        if (!button) return;
        button.classList.add('shake');
        setTimeout(() => button.classList.remove('shake'), 500);
    }

    // ========== SUCCESS ANIMATION ==========

    function showSuccessAnimation() {
        const overlay = document.createElement('div');
        overlay.className = 'success-animation-overlay';
        overlay.innerHTML = `
            <div class="success-animation">
                <div class="checkmark-circle">
                    <svg class="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                        <circle class="checkmark-circle-bg" cx="26" cy="26" r="25" fill="none"/>
                        <path class="checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
                    </svg>
                </div>
                <p class="success-text">Report Submitted!</p>
            </div>
        `;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('show'));
        setTimeout(() => {
            overlay.classList.add('fade-out');
            setTimeout(() => overlay.remove(), 300);
        }, 1500);
    }

    // ========== NOTIFICATIONS ==========

    function showNotification(type, title, message) {
        document.querySelectorAll('.docs-notification').forEach(n => n.remove());

        const icons = { error: '❌', success: '✅', warning: '⚠️', info: 'ℹ️' };

        const notification = document.createElement('div');
        notification.className = `docs-notification docs-notification-${type}`;
        notification.innerHTML = `
            <div class="docs-notification-content">
                <span class="docs-notification-icon">${icons[type] || 'ℹ️'}</span>
                <div class="docs-notification-text">
                    <strong>${title}</strong>
                    <p>${message}</p>
                </div>
                <button class="docs-notification-close" aria-label="Close">×</button>
            </div>
        `;

        notification.querySelector('.docs-notification-close').addEventListener('click', () => {
            notification.classList.add('docs-notification-hide');
            setTimeout(() => notification.remove(), 300);
        });

        document.body.appendChild(notification);
        requestAnimationFrame(() => notification.classList.add('docs-notification-show'));

        setTimeout(() => {
            if (notification.parentElement) {
                notification.classList.add('docs-notification-hide');
                setTimeout(() => notification.remove(), 300);
            }
        }, 5000);
    }

    // ========== MAILTO FALLBACK ==========

    function openMailtoFallback(data) {
        const body = `
CANVAS AI ASSISTANT - ISSUE REPORT
===================================

Issue Type: ${data.issue_type}
Submitted: ${data.timestamp}
Extension Version: ${data.extension_version}

REPORTER INFORMATION
--------------------
Name: ${data.user_name}
Email: ${data.user_email}

ISSUE DETAILS
-------------
Title: ${data.issue_title}

Description:
${data.description}

Steps to Reproduce:
${data.steps_to_reproduce}

SYSTEM INFORMATION
------------------
Browser: ${data.browser}
OS: ${data.os}

Troubleshooting Attempted:
- Refreshed: ${data.tried_refresh}
- Restarted: ${data.tried_restart}
- Reinstalled: ${data.tried_reinstall}
- Checked docs: ${data.tried_docs}

ADDITIONAL INFO
---------------
${data.additional_info}
        `.trim();

        const subject = `[Canvas AI Assistant] ${data.issue_type}: ${data.issue_title}`;
        window.location.href = `mailto:nnguyenminh2801@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }

    // ========== UTILITIES ==========

    function getExtensionVersion() {
        try {
            return chrome.runtime.getManifest().version;
        } catch {
            return 'Unknown';
        }
    }

    function detectSystemInfo() {
        const browserSelect = document.getElementById('browser');
        const osSelect = document.getElementById('os');

        if (browserSelect) {
            const ua = navigator.userAgent;
            if (ua.includes('Edg/')) browserSelect.value = 'edge';
            else if (ua.includes('Chrome/')) browserSelect.value = 'chrome';
            else if (ua.includes('Brave')) browserSelect.value = 'brave';
        }

        if (osSelect) {
            const platform = navigator.platform.toLowerCase();
            const ua = navigator.userAgent.toLowerCase();
            if (platform.includes('win') || ua.includes('windows')) osSelect.value = 'windows';
            else if (platform.includes('mac') || ua.includes('macintosh')) osSelect.value = 'mac';
            else if (ua.includes('cros')) osSelect.value = 'chromeos';
            else if (platform.includes('linux')) osSelect.value = 'linux';
        }
    }

    // ========== SUBMIT ANOTHER ==========

    if (submitAnother) {
        submitAnother.addEventListener('click', () => {
            successMessage.classList.add('fade-out');

            setTimeout(() => {
                form.reset();
                form.style.display = 'block';
                form.classList.add('fade-in');
                successMessage.style.display = 'none';
                successMessage.classList.remove('fade-in', 'fade-out');

                document.querySelectorAll('.option-content.selected').forEach(el => {
                    el.classList.remove('selected');
                });

                animateButtonToNormal(submitButton);
                detectSystemInfo();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }, 300);
        });
    }
});