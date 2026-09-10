<?php get_header(); ?>
<?php
$regular_exclusions = sanatcin_regular_category_exclusions();
$featured = new WP_Query([
    'posts_per_page' => 3,
    'ignore_sticky_posts' => false,
    'category__not_in' => $regular_exclusions
]);
if ($featured->have_posts()) : ?>
<section class="lead-section" aria-label="Öne çıkan haberler">
    <div class="site-wrap lead-layout lead-count-<?php echo esc_attr($featured->post_count); ?>">
        <?php $featured->the_post(); $category = sanatcin_primary_category(); ?>
        <article class="lead-story category-<?php echo esc_attr(sanatcin_category_slug()); ?>">
            <a class="lead-image" href="<?php the_permalink(); ?>"><?php sanatcin_story_image('sanatcin-hero', true); ?></a>
            <div class="lead-copy">
                <span class="eyebrow"><?php echo esc_html($category ? $category->name : 'SanatÇin'); ?></span>
                <h1><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h1>
                <p class="lead-excerpt"><?php echo esc_html(wp_trim_words(get_the_excerpt(), 28)); ?></p>
                <div class="story-meta"><?php sanatcin_story_meta(); ?></div>
            </div>
        </article>
        <?php if ($featured->have_posts()) : ?>
        <div class="lead-secondary">
            <?php while ($featured->have_posts()) : $featured->the_post(); sanatcin_story_card('h2', 'story-card-compact'); endwhile; ?>
        </div>
        <?php endif; ?>
    </div>
</section>
<?php wp_reset_postdata(); else : ?>
<section class="empty-home"><div class="site-wrap"><span class="eyebrow">SanatÇin</span><h1>Çin’in kültür ve sanat gündemi</h1><p>Yeni haberler hazırlanıyor.</p></div></section>
<?php endif; ?>

<?php
$editor_category = sanatcin_editor_category();
$editor_posts = $editor_category ? new WP_Query([
    'posts_per_page' => 3,
    'cat' => $editor_category->term_id,
    'ignore_sticky_posts' => true
]) : null;
if ($editor_posts && $editor_posts->have_posts()) : ?>
<section class="editors-section" aria-labelledby="editors-title">
    <div class="site-wrap">
        <header class="section-heading section-heading-light"><h2 id="editors-title">Editörden</h2><span>Ümran Şatana Ünal’ın haftalık yazıları</span></header>
        <div class="editors-layout editors-count-<?php echo esc_attr($editor_posts->post_count); ?>">
            <?php $editor_posts->the_post(); ?>
            <article class="editors-lead">
                <a class="editors-image" href="<?php the_permalink(); ?>"><?php sanatcin_story_image('sanatcin-hero'); ?></a>
                <div class="editors-copy"><span class="eyebrow">Haftanın Yazısı</span><h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3><p><?php echo esc_html(wp_trim_words(get_the_excerpt(), 30)); ?></p><div class="story-meta"><?php sanatcin_story_meta(true); ?></div></div>
            </article>
            <?php if ($editor_posts->have_posts()) : ?><div class="editors-more">
                <?php while ($editor_posts->have_posts()) : $editor_posts->the_post(); sanatcin_story_card('h3', 'story-card-editor'); endwhile; ?>
            </div><?php endif; ?>
        </div>
    </div>
</section>
<?php wp_reset_postdata(); endif; ?>

<?php
$latest = new WP_Query([
    'posts_per_page' => 9,
    'offset' => 3,
    'ignore_sticky_posts' => true,
    'category__not_in' => $regular_exclusions
]);
if ($latest->have_posts()) : ?>
<section class="section latest-section">
    <div class="site-wrap">
        <header class="section-heading"><h2>Son Eklenenler</h2><span>Kültürden sinemaya yeni haberler</span></header>
        <div class="news-grid news-count-<?php echo esc_attr($latest->post_count); ?>">
            <?php while ($latest->have_posts()) : $latest->the_post(); sanatcin_story_card(); endwhile; wp_reset_postdata(); ?>
        </div>
    </div>
</section>
<?php endif; ?>

<?php if ($featured->found_posts > 3) : ?>
<section class="category-ribbon" aria-label="SanatÇin yayın başlıkları">
    <div class="site-wrap category-ribbon-grid">
        <?php foreach ([
            'kultur-sanat' => ['Kültür', 'Sanat, edebiyat ve miras'],
            'sinema' => ['Sinema', 'Film, dizi ve ekran'],
            'moda-tasarim' => ['Tasarım', 'Moda, mimari ve yaratıcı dünya'],
            'sehir-yasam' => ['Şehir', 'Mekânlar, yaşam ve rotalar']
        ] as $slug => [$label, $description]) : $category = get_category_by_slug($slug); ?>
        <a href="<?php echo esc_url($category ? get_category_link($category) : home_url('/category/' . $slug . '/')); ?>"><strong><?php echo esc_html($label); ?></strong><span><?php echo esc_html($description); ?></span><b aria-hidden="true">→</b></a>
        <?php endforeach; ?>
    </div>
</section>
<?php endif; ?>
<?php get_footer(); ?>
