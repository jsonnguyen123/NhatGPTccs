document.addEventListener('DOMContentLoaded', () => {
    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);
            
            if (targetElement) {
                const headerOffset = 80;
                const elementPosition = targetElement.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });

                // Update active state in TOC
                document.querySelectorAll('.toc-list a').forEach(link => {
                    link.classList.remove('active');
                });
                this.classList.add('active');
            }
        });
    });

    // Highlight active TOC item on scroll
    const sections = document.querySelectorAll('.guide-section[id]');
    const tocLinks = document.querySelectorAll('.toc-list a');

    if (sections.length && tocLinks.length) {
        const observerOptions = {
            rootMargin: '-80px 0px -70% 0px',
            threshold: 0
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const id = entry.target.getAttribute('id');
                    tocLinks.forEach(link => {
                        link.classList.remove('active');
                        if (link.getAttribute('href') === `#${id}`) {
                            link.classList.add('active');
                        }
                    });
                }
            });
        }, observerOptions);

        sections.forEach(section => observer.observe(section));
    }

    // Back link functionality
    const backLink = document.querySelector('.back-link');
    if (backLink) {
        backLink.addEventListener('click', (e) => {
            const href = backLink.getAttribute('href');
            if (href === '#' || !href) {
                e.preventDefault();
                window.history.back();
            }
        });
    }

    // Copy code blocks
    document.querySelectorAll('pre code').forEach(block => {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-code-btn';
        copyBtn.textContent = '📋 Copy';
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(block.textContent).then(() => {
                copyBtn.textContent = '✅ Copied!';
                setTimeout(() => {
                    copyBtn.textContent = '📋 Copy';
                }, 2000);
            });
        });
        block.parentElement.style.position = 'relative';
        block.parentElement.appendChild(copyBtn);
    });
});