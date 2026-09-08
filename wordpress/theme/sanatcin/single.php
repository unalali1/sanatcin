<?php get_header(); ?>
<?php while (have_posts()) : the_post(); $category = sanatcin_primary_category(); ?>
<article class="content-page">
    <div class="site-wrap content-layout">
        <div>
            <header class="article-header">
                <span class="eyebrow"><?php echo esc_html($category ? $category->name : 'SanatÇin'); ?></span>
                <h1><?php the_title(); ?></h1>
                <div class="article-deck"><?php the_excerpt(); ?></div>
                <div class="story-meta"><?php echo esc_html(get_the_date('j F Y')); ?> · <?php echo esc_html(sanatcin_reading_time()); ?> dakika</div>
            </header>
            <figure class="story-image" style="margin:34px 0;aspect-ratio:1.65"><?php sanatcin_story_image('sanatcin-hero'); ?></figure>
            <div class="article-body"><?php the_content(); ?></div>
        </div>
        <aside><div class="sanatcin-source"><strong>SanatÇin</strong><p>Çin'in kültür, sanat, sinema, moda ve şehir yaşamına Türkçe bir pencere.</p></div></aside>
    </div>
</article>
<?php endwhile; ?>
<?php get_footer(); ?>

