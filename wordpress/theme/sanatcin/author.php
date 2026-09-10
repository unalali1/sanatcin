<?php get_header(); ?>
<?php $author_id = get_queried_object_id(); ?>
<section class="content-page author-archive">
    <div class="site-wrap">
        <header class="author-profile">
            <?php echo get_avatar($author_id, 144, '', '', ['class' => 'author-profile-avatar']); ?>
            <div>
                <span class="eyebrow">SanatÇin Yazarı</span>
                <h1 class="archive-title"><?php echo esc_html(get_the_author_meta('display_name', $author_id)); ?></h1>
                <?php $bio = get_the_author_meta('description', $author_id); if ($bio) : ?><p class="archive-intro"><?php echo esc_html($bio); ?></p><?php endif; ?>
            </div>
        </header>
        <div class="archive-grid archive-count-<?php echo esc_attr((int) $GLOBALS['wp_query']->post_count); ?>">
            <?php while (have_posts()) : the_post(); sanatcin_story_card(); endwhile; ?>
        </div>
        <div class="pagination"><?php the_posts_pagination(); ?></div>
    </div>
</section>
<?php get_footer(); ?>
