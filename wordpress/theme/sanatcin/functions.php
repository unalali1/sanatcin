<?php
if (!defined('ABSPATH')) exit;

function sanatcin_setup() {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('html5', ['search-form', 'gallery', 'caption', 'style', 'script']);
    add_theme_support('responsive-embeds');
    register_nav_menus(['primary' => __('Ana menü', 'sanatcin')]);
    add_image_size('sanatcin-hero', 1400, 900, true);
    add_image_size('sanatcin-card', 760, 460, true);
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

function sanatcin_story_image($size = 'sanatcin-card') {
    if (has_post_thumbnail()) {
        the_post_thumbnail($size, ['loading' => 'lazy']);
    } else {
        printf('<img src="%s" alt="" loading="lazy">', esc_url(sanatcin_fallback_image()));
    }
}

