<?php get_header(); ?>
<?php while (have_posts()) : the_post(); $category = sanatcin_primary_category(); ?>
<article class="content-page">
    <div class="site-wrap">
        <nav class="breadcrumb" aria-label="İçerik yolu"><a href="<?php echo esc_url(home_url('/')); ?>">Ana sayfa</a><span>/</span><?php if ($category) : ?><a href="<?php echo esc_url(get_category_link($category)); ?>"><?php echo esc_html($category->name); ?></a><?php endif; ?></nav>
        <header class="article-header category-<?php echo esc_attr(sanatcin_category_slug()); ?>">
            <span class="eyebrow"><?php echo esc_html($category ? $category->name : 'SanatÇin'); ?></span>
            <h1><?php the_title(); ?></h1>
            <div class="article-deck"><?php the_excerpt(); ?></div>
            <div class="article-byline">
                <a class="author-link" href="<?php echo esc_url(get_author_posts_url(get_the_author_meta('ID'))); ?>"><?php echo get_avatar(get_the_author_meta('ID'), 42, '', '', ['class' => 'author-avatar']); ?><span><small>Yazan</small><strong><?php the_author(); ?></strong></span></a>
                <div class="story-meta"><?php sanatcin_story_meta(); ?></div>
            </div>
        </header>
        <?php if (has_post_thumbnail()) : ?><figure class="article-figure">
            <?php sanatcin_story_image('sanatcin-hero', true); ?>
            <?php $caption = sanatcin_post_image_caption(); if ($caption) : ?><figcaption><?php echo esc_html($caption); ?></figcaption><?php endif; ?>
        </figure><?php endif; ?>
        <div class="article-body"><?php the_content(); ?></div>
    </div>
</article>
<?php $related = sanatcin_related_posts(get_the_ID()); if ($related->have_posts()) : ?>
<section class="related-section"><div class="site-wrap"><header class="section-heading"><h2>Benzer Haberler</h2><span>Aynı başlıktan yeni okumalar</span></header><div class="news-grid">
<?php while ($related->have_posts()) : $related->the_post(); sanatcin_story_card(); endwhile; wp_reset_postdata(); ?>
</div></div></section>
<?php endif; ?>
<?php endwhile; ?>
<?php get_footer(); ?>
