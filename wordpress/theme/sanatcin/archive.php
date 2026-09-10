<?php get_header(); ?>
<section class="content-page">
    <div class="site-wrap">
        <span class="eyebrow">SanatÇin Arşivi</span>
        <h1 class="archive-title"><?php echo esc_html(sanatcin_archive_heading()); ?></h1>
        <p class="archive-intro"><?php echo esc_html(category_description() ? wp_strip_all_tags(category_description()) : 'Çin’in gündeminden seçilmiş güncel haberler ve arşiv içerikleri.'); ?></p>
        <div class="archive-grid archive-count-<?php echo esc_attr((int) $GLOBALS['wp_query']->post_count); ?>">
            <?php while (have_posts()) : the_post(); sanatcin_story_card(); endwhile; ?>
        </div>
        <div class="pagination"><?php the_posts_pagination(); ?></div>
    </div>
</section>
<?php get_footer(); ?>
