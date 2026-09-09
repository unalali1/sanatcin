<?php get_header(); ?>
<?php
$featured = new WP_Query(['posts_per_page' => 4, 'ignore_sticky_posts' => false]);
if ($featured->have_posts()) : ?>
<section class="lead-section" aria-label="Öne çıkan haberler">
    <div class="site-wrap lead-layout">
        <?php $featured->the_post(); $category = sanatcin_primary_category(); ?>
        <article class="lead-story">
            <a class="lead-image" href="<?php the_permalink(); ?>"><?php sanatcin_story_image('sanatcin-hero', true); ?></a>
            <div class="lead-copy">
                <span class="eyebrow"><?php echo esc_html($category ? $category->name : 'SanatÇin'); ?></span>
                <h1><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h1>
                <p class="lead-excerpt"><?php echo esc_html(wp_trim_words(get_the_excerpt(), 28)); ?></p>
                <div class="story-meta"><?php echo esc_html(sanatcin_reading_time()); ?> dakikalık okuma · <?php echo esc_html(get_the_date('j F Y')); ?></div>
            </div>
        </article>
        <?php if ($featured->have_posts()) : ?>
        <div class="lead-secondary">
            <?php while ($featured->have_posts()) : $featured->the_post(); sanatcin_story_card('h2'); endwhile; ?>
        </div>
        <?php endif; ?>
    </div>
</section>
<?php wp_reset_postdata(); else : ?>
<section class="empty-home"><div class="site-wrap"><span class="eyebrow">SanatÇin</span><h1>Çin’in kültür ve sanat gündemi</h1><p>Yeni haberler hazırlanıyor.</p></div></section>
<?php endif; ?>

<?php
$latest = new WP_Query(['posts_per_page' => 8, 'offset' => 4, 'ignore_sticky_posts' => true]);
if ($latest->have_posts()) : ?>
<section class="section latest-section">
    <div class="site-wrap">
        <header class="section-heading"><h2>Son Eklenenler</h2><span>Kültürden sinemaya yeni haberler</span></header>
        <div class="news-grid">
            <?php while ($latest->have_posts()) : $latest->the_post(); sanatcin_story_card(); endwhile; wp_reset_postdata(); ?>
        </div>
    </div>
</section>
<?php endif; ?>
<?php get_footer(); ?>
