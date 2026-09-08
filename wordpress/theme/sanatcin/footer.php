</main>
<section class="newsletter">
    <div class="site-wrap newsletter-grid">
        <div>
            <span class="eyebrow" style="color:#ffe19f">Haftalık seçki</span>
            <h2>SanatÇin Bülteni</h2>
            <p>Çin'in kültür, sanat, sinema, moda ve yaşam dünyasından görülmeye değer hikâyeler.</p>
        </div>
        <div>
            <p>Haftanın gürültüsünü değil, öne çıkan hikâyelerini gönderiyoruz.</p>
            <form class="newsletter-form" action="#" method="post">
                <label class="screen-reader-text" for="newsletter-email">E-posta adresiniz</label>
                <input id="newsletter-email" name="email" type="email" placeholder="E-posta adresiniz" required>
                <button type="submit">Abone ol →</button>
            </form>
        </div>
    </div>
</section>
<footer class="site-footer">
    <div class="site-wrap footer-row">
        <a class="footer-brand" href="<?php echo esc_url(home_url('/')); ?>">SanatÇin</a>
        <div class="footer-links">
            <a href="<?php echo esc_url(home_url('/hakkimizda/')); ?>">Hakkımızda</a><span>·</span>
            <a href="<?php echo esc_url(home_url('/iletisim/')); ?>">İletişim</a><span>·</span>
            <a href="<?php echo esc_url(home_url('/gizlilik/')); ?>">Gizlilik</a>
        </div>
        <div class="social-links" aria-label="Sosyal medya">
            <a href="#" aria-label="Instagram"><span class="social-icon">◎</span>Instagram</a>
            <a href="#" aria-label="X"><span class="social-icon">𝕏</span></a>
            <a href="#" aria-label="YouTube"><span class="social-icon">▶</span>YouTube</a>
        </div>
    </div>
</footer>
<?php wp_footer(); ?>
</body>
</html>

