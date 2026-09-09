<?php get_header(); ?>
<?php while (have_posts()) : the_post(); $category = sanatcin_primary_category(); ?>
<article class="content-page">
    <div class="site-wrap">
        <header class="article-header">
            <span class="eyebrow"><?php echo esc_html($category ? $category->name : 'SanatÇin'); ?></span>
            <h1><?php the_title(); ?></h1>
            <div class="article-deck"><?php the_excerpt(); ?></div>
            <div class="story-meta"><?php echo esc_html(get_the_date('j F Y')); ?> · <?php echo esc_html(sanatcin_reading_time()); ?> dakikalık okuma</div>
        </header>
        <figure class="article-figure">
            <?php sanatcin_story_image('sanatcin-hero', true); ?>
            <?php $caption = sanatcin_post_image_caption(); if ($caption) : ?><figcaption><?php echo esc_html($caption); ?></figcaption><?php endif; ?>
        </figure>
        <div class="article-body"><?php the_content(); ?></div>
    </div>
</article>
<?php endwhile; ?>
<?php get_footer(); ?>
