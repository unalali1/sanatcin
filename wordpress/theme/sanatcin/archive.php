<?php get_header(); ?>
<section class="content-page">
    <div class="site-wrap">
        <span class="eyebrow">SanatÇin Arşivi</span>
        <h1 class="archive-title"><?php echo esc_html(sanatcin_archive_heading()); ?></h1>
        <div class="archive-grid">
            <?php while (have_posts()) : the_post(); sanatcin_story_card(); endwhile; ?>
        </div>
        <div class="pagination"><?php the_posts_pagination(); ?></div>
    </div>
</section>
<?php get_footer(); ?>
