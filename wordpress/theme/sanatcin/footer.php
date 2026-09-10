</main>
<footer class="site-footer">
    <div class="site-wrap footer-row">
        <div class="footer-about"><a class="footer-brand" href="<?php echo esc_url(home_url('/')); ?>">SanatÇin</a><p>Çin’in kültür, sanat, sinema, moda ve şehir yaşamına bağımsız Türkçe bakış.</p></div>
        <div class="footer-links">
            <?php foreach (['kultur-sanat' => 'Kültür & Sanat', 'sinema' => 'Sinema', 'moda-tasarim' => 'Moda & Tasarım', 'sehir-yasam' => 'Şehir & Yaşam'] as $slug => $label) : $category = get_category_by_slug($slug); if ($category) : ?>
                <a href="<?php echo esc_url(get_category_link($category)); ?>"><?php echo esc_html($label); ?></a>
            <?php endif; endforeach; ?>
        </div>
        <p class="copyright">© <?php echo esc_html(wp_date('Y')); ?> SanatÇin</p>
    </div>
</footer>
<?php wp_footer(); ?>
</body>
</html>
