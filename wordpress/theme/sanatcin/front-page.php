<?php get_header(); ?>
<?php
$hero = new WP_Query(['posts_per_page' => 4, 'ignore_sticky_posts' => false]);
if ($hero->have_posts()) : ?>
<section class="hero" aria-label="Öne çıkan haberler">
    <?php $slide = 0; while ($hero->have_posts()) : $hero->the_post(); $category = sanatcin_primary_category(); ?>
        <article class="hero-slide <?php echo $slide === 0 ? 'is-active' : ''; ?>" data-slide="<?php echo esc_attr($slide); ?>">
            <div class="hero-copy">
                <span class="eyebrow"><?php echo esc_html($category ? $category->name : 'SanatÇin'); ?></span>
                <h1><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h1>
                <div class="hero-excerpt"><?php echo esc_html(wp_trim_words(get_the_excerpt(), 24)); ?></div>
                <div class="story-meta"><?php echo esc_html(sanatcin_reading_time()); ?> dakikalık okuma · <?php echo esc_html(get_the_date('j F Y')); ?></div>
            </div>
            <a class="hero-image" href="<?php the_permalink(); ?>"><?php sanatcin_story_image('sanatcin-hero'); ?></a>
        </article>
    <?php $slide++; endwhile; wp_reset_postdata(); ?>
    <div class="hero-controls">
        <button type="button" data-prev aria-label="Önceki haber">‹</button>
        <div class="hero-dots">
            <?php for ($i = 0; $i < $slide; $i++) : ?>
                <button type="button" class="hero-dot <?php echo $i === 0 ? 'is-active' : ''; ?>" data-go="<?php echo esc_attr($i); ?>"><?php echo esc_html(str_pad((string)($i + 1), 2, '0', STR_PAD_LEFT)); ?></button>
            <?php endfor; ?>
        </div>
        <button type="button" data-next aria-label="Sonraki haber">›</button>
    </div>
</section>
<?php endif; ?>

<section class="section">
    <div class="site-wrap">
        <header class="section-heading"><h2>Bugün SanatÇin'de</h2><span>Günün öne çıkan içerikleri</span></header>
        <div class="news-grid">
            <?php
            $latest = new WP_Query(['posts_per_page' => 5, 'offset' => 4, 'ignore_sticky_posts' => true]);
            while ($latest->have_posts()) : $latest->the_post(); $category = sanatcin_primary_category(); ?>
                <article class="story-card">
                    <a class="story-image" href="<?php the_permalink(); ?>"><?php sanatcin_story_image(); ?></a>
                    <div class="story-body">
                        <span class="eyebrow"><?php echo esc_html($category ? $category->name : 'SanatÇin'); ?></span>
                        <h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
                        <div class="story-meta"><?php echo esc_html(sanatcin_reading_time()); ?> dakika</div>
                    </div>
                </article>
            <?php endwhile; wp_reset_postdata(); ?>
        </div>
    </div>
</section>

<section class="editorial-strip">
    <div class="site-wrap editorial-grid">
        <article class="editorial-item"><span class="eyebrow">Köşe</span><h3>Çin kültürüne yakından bakış</h3><p>Aynı hikâye, farklı bir bakışla daha fazlasını anlatır.</p></article>
        <article class="editorial-item"><span class="eyebrow">Son yazı</span><h3>Sanattan sinemaya: Kültürel mirasın yeni yolculuğu</h3><p>SanatÇin editoryası</p></article>
        <article class="editorial-item"><span class="eyebrow">Arşivden</span><h3>Çin'in kısa dizileri dünyayı nasıl yakaladı?</h3><p>Dosya</p></article>
    </div>
</section>
<?php get_footer(); ?>

