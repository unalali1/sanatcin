<?php get_header(); ?>
<section class="content-page">
    <div class="site-wrap">
        <h1 class="archive-title"><?php echo is_search() ? 'Arama sonuçları' : 'Son Haberler'; ?></h1>
        <div class="archive-grid">
            <?php if (have_posts()) : while (have_posts()) : the_post(); sanatcin_story_card(); ?>
            <?php endwhile; else : ?><p>Henüz içerik bulunmuyor.</p><?php endif; ?>
        </div>
        <div class="pagination"><?php the_posts_pagination(); ?></div>
    </div>
</section>
<?php get_footer(); ?>
