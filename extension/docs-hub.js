document.addEventListener('DOMContentLoaded', () => {
    // Back to Settings button
    const backToSettings = document.getElementById('back-to-settings');
    if (backToSettings) {
        backToSettings.addEventListener('click', (e) => {
            e.preventDefault();
            if (chrome.runtime?.openOptionsPage) {
                chrome.runtime.openOptionsPage();
            } else {
                window.location.href = chrome.runtime.getURL('options-enhanced.html');
            }
        });
    }

    // Guide card links
    const guideCards = document.querySelectorAll('.guide-card');
    guideCards.forEach(card => {
        card.addEventListener('click', (e) => {
            const href = card.getAttribute('href') || card.dataset.href;
            if (href && href !== '#') {
                window.location.href = href;
            }
        });
    });

    // Community Forum - Show coming soon message
    const communityCard = document.getElementById('community-forum-card');
    if (communityCard) {
        communityCard.addEventListener('click', (e) => {
            e.preventDefault();
            showNotification('Coming Soon', 'The Community Forum feature is not available yet. Stay tuned for updates!', 'info');
        });
    }

    // Notification function
    function showNotification(title, message, type = 'info') {
        // Remove existing notification if any
        const existing = document.querySelector('.docs-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = `docs-notification docs-notification-${type}`;
        notification.innerHTML = `
            <div class="docs-notification-content">
                <div class="docs-notification-icon">${type === 'info' ? 'ℹ️' : type === 'success' ? '✅' : '⚠️'}</div>
                <div class="docs-notification-text">
                    <strong>${title}</strong>
                    <p>${message}</p>
                </div>
                <button class="docs-notification-close">×</button>
            </div>
        `;

        document.body.appendChild(notification);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            notification.classList.add('docs-notification-hide');
            setTimeout(() => notification.remove(), 300);
        }, 5000);

        // Close button
        notification.querySelector('.docs-notification-close').addEventListener('click', () => {
            notification.classList.add('docs-notification-hide');
            setTimeout(() => notification.remove(), 300);
        });

        // Trigger animation
        requestAnimationFrame(() => {
            notification.classList.add('docs-notification-show');
        });
    }

    // Make function globally available
    window.showDocsNotification = showNotification;
});