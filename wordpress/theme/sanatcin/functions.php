<?php
if (!defined('ABSPATH')) exit;

function sanatcin_setup() {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('html5', ['search-form', 'gallery', 'caption', 'style', 'script']);
    add_theme_support('responsive-embeds');
    register_nav_menus(['primary' => __('Ana menü', 'sanatcin')]);
    add_image_size('sanatcin-hero', 1440, 960, true);
    add_image_size('sanatcin-card', 800, 600, true);
}
add_action('after_setup_theme', 'sanatcin_setup');

function sanatcin_assets() {
    wp_enqueue_style('sanatcin-style', get_stylesheet_uri(), [], wp_get_theme()->get('Version'));
    wp_enqueue_script('sanatcin-site', get_template_directory_uri() . '/assets/js/site.js', [], wp_get_theme()->get('Version'), true);
}
add_action('wp_enqueue_scripts', 'sanatcin_assets');

function sanatcin_widgets() {
    register_sidebar([
        'name' => __('Üst reklam alanı', 'sanatcin'),
        'id' => 'top-ad',
        'before_widget' => '<div class="top-ad-widget">',
        'after_widget' => '</div>',
        'before_title' => '<span class="screen-reader-text">',
        'after_title' => '</span>'
    ]);
}
add_action('widgets_init', 'sanatcin_widgets');

function sanatcin_reading_time($post_id = null) {
    $content = get_post_field('post_content', $post_id ?: get_the_ID());
    $words = preg_split('/\s+/u', wp_strip_all_tags($content), -1, PREG_SPLIT_NO_EMPTY);
    return max(1, (int) ceil(count($words) / 220));
}

function sanatcin_primary_category($post_id = null) {
    $categories = get_the_category($post_id ?: get_the_ID());
    return $categories ? $categories[0] : null;
}

function sanatcin_fallback_image($post_id = null) {
    $category = sanatcin_primary_category($post_id);
    $map = [
        'kultur-sanat' => 'museum.webp',
        'sinema' => 'cinema.webp',
        'moda-tasarim' => 'fashion.webp',
        'sehir-yasam' => 'city.webp'
    ];
    $file = $map[$category ? $category->slug : ''] ?? 'hero.webp';
    return get_template_directory_uri() . '/assets/images/' . $file;
}

function sanatcin_category_slug($post_id = null) {
    $category = sanatcin_primary_category($post_id);
    return $category ? sanitize_html_class($category->slug) : 'sanatcin';
}

function sanatcin_story_image($size = 'sanatcin-card', $priority = false) {
    $attributes = [
        'loading' => $priority ? 'eager' : 'lazy',
        'decoding' => 'async'
    ];
    if ($priority) $attributes['fetchpriority'] = 'high';
    if (has_post_thumbnail()) {
        the_post_thumbnail($size, $attributes);
    } else {
        $category = sanatcin_primary_category();
        printf(
            '<span class="story-placeholder" role="img" aria-label="%s"><span>%s</span><small>SanatÇin</small></span>',
            esc_attr__('Bu haber için kaynak görsel bulunamadı', 'sanatcin'),
            esc_html($category ? $category->name : 'SanatÇin')
        );
    }
}

function sanatcin_post_image_caption($post_id = null) {
    $thumbnail_id = get_post_thumbnail_id($post_id ?: get_the_ID());
    if (!$thumbnail_id) return '';
    return trim((string) wp_get_attachment_caption($thumbnail_id));
}

function sanatcin_archive_heading() {
    if (is_category()) return single_cat_title('', false);
    if (is_tag()) return single_tag_title('', false);
    return get_the_archive_title();
}

function sanatcin_story_card($heading = 'h3', $variant = '') {
    $category = sanatcin_primary_category();
    ?>
    <article class="story-card category-<?php echo esc_attr(sanatcin_category_slug()); ?> <?php echo esc_attr($variant); ?>">
        <a class="story-image" href="<?php the_permalink(); ?>" aria-hidden="true" tabindex="-1"><?php sanatcin_story_image(); ?></a>
        <div class="story-body">
            <span class="eyebrow"><?php echo esc_html($category ? $category->name : 'SanatÇin'); ?></span>
            <<?php echo tag_escape($heading); ?>><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></<?php echo tag_escape($heading); ?>>
            <div class="story-meta"><?php echo esc_html(get_the_date('j F Y')); ?></div>
        </div>
    </article>
    <?php
}

function sanatcin_related_posts($post_id, $limit = 3) {
    $category_ids = wp_get_post_categories($post_id);
    return new WP_Query([
        'posts_per_page' => $limit,
        'post__not_in' => [$post_id],
        'category__in' => $category_ids,
        'ignore_sticky_posts' => true
    ]);
}
