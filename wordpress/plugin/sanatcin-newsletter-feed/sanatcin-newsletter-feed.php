<?php
/**
 * Plugin Name: SanatÇin Newsletter Feed
 * Description: Brevo haftalık bülteni için görselli ve kategori dengeli özel RSS akışı sağlar.
 * Version: 0.1.0
 * Requires at least: 6.5
 * Requires PHP: 8.1
 */

if (!defined('ABSPATH')) exit;

const SANATCIN_NEWSLETTER_FEED_VERSION = '0.1.0';
const SANATCIN_NEWSLETTER_FEED_SLUG = 'sanatcin-bulten';
const SANATCIN_NEWSLETTER_FEED_LIMIT = 6;

function sanatcin_newsletter_register_feed() {
    add_feed(SANATCIN_NEWSLETTER_FEED_SLUG, 'sanatcin_newsletter_render_feed');
}
add_action('init', 'sanatcin_newsletter_register_feed');

function sanatcin_newsletter_activate() {
    sanatcin_newsletter_register_feed();
    flush_rewrite_rules();
}
register_activation_hook(__FILE__, 'sanatcin_newsletter_activate');

function sanatcin_newsletter_deactivate() {
    flush_rewrite_rules();
}
register_deactivation_hook(__FILE__, 'sanatcin_newsletter_deactivate');

function sanatcin_newsletter_recent_post($category_id, array $exclude = []) {
    $base = [
        'post_type' => 'post',
        'post_status' => 'publish',
        'posts_per_page' => 1,
        'ignore_sticky_posts' => true,
        'cat' => $category_id,
        'post__not_in' => $exclude,
        'date_query' => [['after' => '7 days ago', 'inclusive' => true]],
    ];

    $scored = new WP_Query(array_merge($base, [
        'meta_key' => 'sanatcin_score',
        'orderby' => ['meta_value_num' => 'DESC', 'date' => 'DESC'],
    ]));

    if ($scored->have_posts()) return $scored->posts[0];

    $latest = new WP_Query(array_merge($base, [
        'orderby' => 'date',
        'order' => 'DESC',
    ]));

    return $latest->have_posts() ? $latest->posts[0] : null;
}

function sanatcin_newsletter_select_posts() {
    $selected = [];
    $selected_ids = [];

    $editor = get_category_by_slug('editorden');
    if ($editor) {
        $editor_post = sanatcin_newsletter_recent_post((int) $editor->term_id);
        if ($editor_post) {
            $selected[] = $editor_post;
            $selected_ids[] = (int) $editor_post->ID;
        }
    }

    $regular_slugs = ['kultur-sanat', 'sinema', 'moda-tasarim', 'sehir-yasam'];
    $regular_category_ids = [];

    foreach ($regular_slugs as $slug) {
        $category = get_category_by_slug($slug);
        if (!$category) continue;

        $regular_category_ids[] = (int) $category->term_id;
        $post = sanatcin_newsletter_recent_post((int) $category->term_id, $selected_ids);
        if (!$post) continue;

        $selected[] = $post;
        $selected_ids[] = (int) $post->ID;
    }

    $remaining = SANATCIN_NEWSLETTER_FEED_LIMIT - count($selected);
    if ($remaining > 0 && $regular_category_ids) {
        $fill = new WP_Query([
            'post_type' => 'post',
            'post_status' => 'publish',
            'posts_per_page' => $remaining,
            'ignore_sticky_posts' => true,
            'category__in' => $regular_category_ids,
            'post__not_in' => $selected_ids,
            'date_query' => [['after' => '7 days ago', 'inclusive' => true]],
            'meta_key' => 'sanatcin_score',
            'orderby' => ['meta_value_num' => 'DESC', 'date' => 'DESC'],
        ]);

        foreach ($fill->posts as $post) {
            $selected[] = $post;
            $selected_ids[] = (int) $post->ID;
        }
    }

    return array_slice($selected, 0, SANATCIN_NEWSLETTER_FEED_LIMIT);
}

function sanatcin_newsletter_cdata($value) {
    return str_replace(']]>', ']]]]><![CDATA[>', (string) $value);
}

function sanatcin_newsletter_item_html(WP_Post $post) {
    $permalink = get_permalink($post);
    $excerpt = get_the_excerpt($post);
    if (!$excerpt) $excerpt = wp_trim_words(wp_strip_all_tags($post->post_content), 38);

    $categories = get_the_category($post->ID);
    $category_name = $categories ? $categories[0]->name : 'SanatÇin';
    $image = get_the_post_thumbnail_url($post, 'large');

    $html = '';
    if ($image) {
        $html .= '<img src="' . esc_url($image) . '" alt="" style="display:block;width:100%;height:auto;margin:0 0 16px;">';
    }
    $html .= '<p style="margin:0 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;">' . esc_html($category_name) . '</p>';
    $html .= '<p style="margin:0 0 14px;">' . esc_html($excerpt) . '</p>';
    $html .= '<p style="margin:0;"><a href="' . esc_url($permalink) . '">Haberi oku →</a></p>';

    return $html;
}

function sanatcin_newsletter_render_feed() {
    $posts = sanatcin_newsletter_select_posts();
    $last_build = $posts ? get_post_time('D, d M Y H:i:s +0000', true, $posts[0]) : gmdate('D, d M Y H:i:s +0000');

    header('Content-Type: application/rss+xml; charset=' . get_option('blog_charset'), true);

    echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
    ?>
<rss version="2.0"
    xmlns:content="http://purl.org/rss/1.0/modules/content/"
    xmlns:media="http://search.yahoo.com/mrss/">
<channel>
    <title><?php echo esc_html(get_bloginfo('name') . ' Bülteni'); ?></title>
    <link><?php echo esc_url(home_url('/')); ?></link>
    <description>SanatÇin haftalık editoryal seçkisi</description>
    <language><?php echo esc_html(get_bloginfo('language') ?: 'tr-TR'); ?></language>
    <lastBuildDate><?php echo esc_html($last_build); ?></lastBuildDate>
<?php foreach ($posts as $post) :
    $permalink = get_permalink($post);
    $description = sanatcin_newsletter_item_html($post);
    $image = get_the_post_thumbnail_url($post, 'large');
    $categories = get_the_category($post->ID);
?>
    <item>
        <title><![CDATA[<?php echo sanatcin_newsletter_cdata(get_the_title($post)); ?>]]></title>
        <link><?php echo esc_url($permalink); ?></link>
        <guid isPermaLink="true"><?php echo esc_url($permalink); ?></guid>
        <pubDate><?php echo esc_html(get_post_time(DATE_RSS, true, $post)); ?></pubDate>
<?php foreach ($categories as $category) : ?>
        <category><![CDATA[<?php echo sanatcin_newsletter_cdata($category->name); ?>]]></category>
<?php endforeach; ?>
        <description><![CDATA[<?php echo sanatcin_newsletter_cdata($description); ?>]]></description>
        <content:encoded><![CDATA[<?php echo sanatcin_newsletter_cdata($description); ?>]]></content:encoded>
<?php if ($image) : ?>
        <media:content url="<?php echo esc_url($image); ?>" medium="image" />
<?php endif; ?>
    </item>
<?php endforeach; ?>
</channel>
</rss>
<?php
    exit;
}
