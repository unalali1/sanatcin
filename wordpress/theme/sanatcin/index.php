<?php get_header(); ?>
<section class="content-page">
    <div class="site-wrap">
        <h1 class="archive-title"><?php echo is_search() ? 'Arama sonuçları' : 'Son Haberler'; ?></h1>
        <div class="archive-grid">
            <?php if (have_posts()) : while (have_posts()) : the_post(); $category = sanatcin_primary_category(); ?>
                <article class="story-card">
                    <a class="story-image" href="<?php the_permalink(); ?>"><?php sanatcin_story_image(); ?></a>
                    <div class="story-body"><span class="eyebrow"><?php echo esc_html($category ? $category->name : 'SanatÇin'); ?></span><h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3><div class="story-meta"><?php echo esc_html(get_the_date()); ?></div></div>
                </article>
            <?php endwhile; else : ?><p>Henüz içerik bulunmuyor.</p><?php endif; ?>
        </div>
        <div class="pagination"><?php the_posts_pagination(); ?></div>
    </div>
</section>
<?php get_footer(); ?>

