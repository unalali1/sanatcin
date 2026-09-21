<?php
if (!defined('ABSPATH')) exit;

function sanatcin_setup() {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('html5', ['search-form', 'gallery', 'caption', 'style', 'script']);
    add_theme_support('responsive-embeds');
    add_theme_support('custom-logo', ['height' => 220, 'width' => 423, 'flex-height' => true, 'flex-width' => true]);
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

function sanatcin_primary_category($post_id = null) {
    $categories = get_the_category($post_id ?: get_the_ID());
    return $categories ? $categories[0] : null;
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
    if (is_author()) return sprintf('Yazar: %s', get_the_author_meta('display_name', get_queried_object_id()));
    return wp_strip_all_tags(get_the_archive_title());
}

function sanatcin_archive_intro() {
    if (is_author()) {
        $description = get_the_author_meta('description', get_queried_object_id());
        return $description ?: 'Bu yazara ait güncel yazılar ve arşiv içerikleri.';
    }
    if (is_category()) {
        $description = category_description();
        if ($description) return wp_strip_all_tags($description);
    }
    return 'Çin’in gündeminden seçilmiş güncel haberler ve arşiv içerikleri.';
}

function sanatcin_editor_category() {
    $category = get_category_by_slug('editorden');
    return $category instanceof WP_Term ? $category : null;
}

function sanatcin_append_editor_menu($items, $args) {
    if (($args->theme_location ?? '') !== 'primary') return $items;
    $category = sanatcin_editor_category();
    if (!$category || $category->count < 1 || str_contains($items, '/category/editorden/')) return $items;
    return $items . sprintf('<li class="menu-item menu-item-editorden"><a href="%s">EDİTÖRDEN</a></li>', esc_url(get_category_link($category)));
}
add_filter('wp_nav_menu_items', 'sanatcin_append_editor_menu', 10, 2);

function sanatcin_regular_category_exclusions() {
    $category = sanatcin_editor_category();
    return $category ? [(int) $category->term_id] : [];
}

function sanatcin_story_meta($show_author = false) {
    printf('<time datetime="%s">%s</time>', esc_attr(get_the_date(DATE_W3C)), esc_html(get_the_date('j F Y')));
    if ($show_author) {
        printf('<span aria-hidden="true">·</span><a href="%s">%s</a>', esc_url(get_author_posts_url(get_the_author_meta('ID'))), esc_html(get_the_author()));
    }
}

function sanatcin_author_data($post_id = null) {
    $post_id = $post_id ?: get_the_ID();
    if (get_post_meta($post_id, 'sanatcin_source_url', true)) {
        return [
            'name' => 'SanatÇin Haber Merkezi',
            'url' => home_url('/hakkimizda/'),
            'type' => 'Organization'
        ];
    }
    $author_id = (int) get_post_field('post_author', $post_id);
    return [
        'name' => get_the_author_meta('display_name', $author_id) ?: 'SanatÇin',
        'url' => get_author_posts_url($author_id),
        'type' => 'Person'
    ];
}

function sanatcin_story_card($heading = 'h3', $variant = '') {
    $category = sanatcin_primary_category();
    ?>
    <article class="story-card category-<?php echo esc_attr(sanatcin_category_slug()); ?> <?php echo esc_attr($variant); ?>">
        <a class="story-image" href="<?php the_permalink(); ?>" aria-hidden="true" tabindex="-1"><?php sanatcin_story_image(); ?></a>
        <div class="story-body">
            <span class="eyebrow"><?php echo esc_html($category ? $category->name : 'SanatÇin'); ?></span>
            <<?php echo tag_escape($heading); ?>><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></<?php echo tag_escape($heading); ?>>
            <div class="story-meta"><?php sanatcin_story_meta($category && $category->slug === 'editorden'); ?></div>
        </div>
    </article>
    <?php
}

function sanatcin_page_link($slug, $label) {
    $page = get_page_by_path($slug);
    if (!$page) return;
    printf('<a href="%s">%s</a>', esc_url(get_permalink($page)), esc_html($label));
}

function sanatcin_brand_title_parts($parts) {
    $parts['site'] = 'SanatÇin';
    return $parts;
}
add_filter('document_title_parts', 'sanatcin_brand_title_parts');

function sanatcin_meta_description() {
    if (is_singular('post')) {
        $description = get_the_excerpt();
    } elseif (is_category() || is_author()) {
        $description = sanatcin_archive_intro();
    } else {
        $description = 'Çin’in kültür, sanat, sinema, moda ve şehir yaşamından seçilmiş haberler; bağımsız ve doğal Türkçe anlatımla SanatÇin’de.';
    }
    return wp_trim_words(wp_strip_all_tags($description), 28, '');
}

function sanatcin_social_image() {
    if (is_singular('post') && has_post_thumbnail()) return get_the_post_thumbnail_url(get_the_ID(), 'full');
    return get_template_directory_uri() . '/assets/images/logo.webp';
}

function sanatcin_head_metadata() {
    if (defined('WPSEO_VERSION') || defined('RANK_MATH_VERSION')) return;
    $description = sanatcin_meta_description();
    $title = wp_get_document_title();
    $url = is_singular() ? get_permalink() : home_url(add_query_arg([], $GLOBALS['wp']->request ?? ''));
    $image = sanatcin_social_image();
    printf("\n<meta name=\"description\" content=\"%s\">", esc_attr($description));
    printf("\n<meta property=\"og:locale\" content=\"tr_TR\">");
    printf("\n<meta property=\"og:type\" content=\"%s\">", is_singular('post') ? 'article' : 'website');
    printf("\n<meta property=\"og:site_name\" content=\"SanatÇin\">");
    printf("\n<meta property=\"og:title\" content=\"%s\">", esc_attr($title));
    printf("\n<meta property=\"og:description\" content=\"%s\">", esc_attr($description));
    printf("\n<meta property=\"og:url\" content=\"%s\">", esc_url($url));
    printf("\n<meta property=\"og:image\" content=\"%s\">", esc_url($image));
    printf("\n<meta name=\"twitter:card\" content=\"summary_large_image\">\n");

    if (is_singular('post')) {
        $post_id = get_queried_object_id();
        $author = sanatcin_author_data($post_id);
        $schema = [
            '@context' => 'https://schema.org',
            '@type' => 'NewsArticle',
            'headline' => get_the_title(),
            'description' => $description,
            'datePublished' => get_the_date(DATE_W3C),
            'dateModified' => get_the_modified_date(DATE_W3C),
            'mainEntityOfPage' => get_permalink(),
            'image' => [$image],
            'author' => ['@type' => $author['type'], 'name' => $author['name'], 'url' => $author['url']],
            'publisher' => ['@type' => 'Organization', 'name' => 'SanatÇin', 'logo' => ['@type' => 'ImageObject', 'url' => get_template_directory_uri() . '/assets/images/logo.webp']]
        ];
    } else {
        $schema = [
            '@context' => 'https://schema.org',
            '@type' => 'Organization',
            'name' => 'SanatÇin',
            'url' => home_url('/'),
            'logo' => get_template_directory_uri() . '/assets/images/logo.webp'
        ];
    }
    printf('<script type="application/ld+json">%s</script>', wp_json_encode($schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}
add_action('wp_head', 'sanatcin_head_metadata', 5);

function sanatcin_related_posts($post_id, $limit = 3) {
    $category_ids = wp_get_post_categories($post_id);
    return new WP_Query([
        'posts_per_page' => $limit,
        'post__not_in' => [$post_id],
        'category__in' => $category_ids,
        'ignore_sticky_posts' => true
    ]);
}


/**
 * SanatÇin X/Buffer editorial layer.
 *
 * Keeps WP to Buffer Pro's existing account, scheduling and link/image handling,
 * while replacing only the X/Twitter status text with a compact editorial hook.
 */
function sanatcin_x_trim_chars($text, $limit) {
    $text = trim(preg_replace('/\s+/u', ' ', wp_strip_all_tags((string) $text)));
    if ($limit < 1) return '';
    $length = function_exists('mb_strlen') ? mb_strlen($text, 'UTF-8') : strlen($text);
    if ($length <= $limit) return $text;

    $slice = function_exists('mb_substr')
        ? mb_substr($text, 0, max(1, $limit - 1), 'UTF-8')
        : substr($text, 0, max(1, $limit - 1));

    $slice = preg_replace('/\s+\S*$/u', '', $slice);
    return rtrim($slice, " \t\n\r\0\x0B,;:-–—") . '…';
}

function sanatcin_x_emoji($post) {
    $title = wp_strip_all_tags((string) $post->post_title);
    $excerpt = wp_strip_all_tags((string) $post->post_excerpt);
    $haystack = function_exists('mb_strtolower')
        ? mb_strtolower($title . ' ' . $excerpt, 'UTF-8')
        : strtolower($title . ' ' . $excerpt);

    $keyword_map = [
        '/akşam|gece|ay ışığı|ayışığı/u' => '🌙',
        '/yemek|mutfak|sofra|restoran|çay|kahve/u' => '🍜',
        '/opera|tiyatro|müzikal|sahne|performans/u' => '🎭',
        '/film|sinema|dizi|festival/u' => '🎬',
        '/moda|tasarım|koleksiyon|podyum|couture/u' => '✨',
        '/sergi|müze|resim|heykel|kaligrafi|sanat/u' => '🎨',
        '/şehir|sokak|mahalle|park|yürüyüş/u' => '🌆'
    ];
    foreach ($keyword_map as $pattern => $emoji) {
        if (preg_match($pattern, $haystack)) return $emoji;
    }

    $categories = get_the_category($post->ID);
    $slug = $categories ? $categories[0]->slug : '';
    return [
        'kultur-sanat' => '🎨',
        'sinema' => '🎬',
        'moda-tasarim' => '✨',
        'sehir-yasam' => '🌆',
        'editorden' => '✍️'
    ][$slug] ?? '🔎';
}

function sanatcin_x_editorial_hook($post) {
    $manual = trim((string) get_post_meta($post->ID, 'sanatcin_social_x_text', true));
    if ($manual !== '') return $manual;

    $hook = trim((string) $post->post_excerpt);
    if ($hook === '') {
        $content = preg_replace('/<aside\b[^>]*>.*?<\/aside>/isu', ' ', (string) $post->post_content);
        $hook = wp_strip_all_tags(strip_shortcodes($content));
    }

    $hook = trim(preg_replace('/\s+/u', ' ', $hook));
    $title = trim(wp_strip_all_tags((string) $post->post_title));
    if ($title !== '' && $hook !== '') {
        $pattern = '/^' . preg_quote($title, '/') . '\s*[-–—:,.!?]*\s*/iu';
        $hook = trim((string) preg_replace($pattern, '', $hook, 1));
    }

    return $hook !== '' ? $hook : $title;
}

function sanatcin_buffer_x_build_args($args, $post, $profile_id, $service, $status, $action) {
    if (!is_array($args) || !($post instanceof WP_Post) || $post->post_type !== 'post') return $args;

    $network = strtolower((string) $service);
    if (!in_array($network, ['twitter', 'x'], true)) return $args;

    $url = get_permalink($post);
    if (!$url) return $args;

    $emoji = sanatcin_x_emoji($post);
    $title = trim(wp_strip_all_tags((string) $post->post_title));
    $hook = trim(preg_replace('/\\s+/u', ' ', sanatcin_x_editorial_hook($post)));

    // Keep only the first explanatory sentence.
    $sentences = preg_split('/(?<=[.!?…])\\s+/u', $hook, 2);
    if (is_array($sentences) && isset($sentences[0])) $hook = trim($sentences[0]);

    // X only: emoji + title + one concise explanatory sentence + one URL.
    // Instagram/Facebook keep WP to Buffer Pro's existing formatting untouched.
    $separator = "\n";
    $emoji_prefix = trim($emoji . ' ');
    $url_length = function_exists('mb_strlen') ? mb_strlen($url, 'UTF-8') : strlen($url);
    $emoji_length = function_exists('mb_strlen') ? mb_strlen($emoji_prefix, 'UTF-8') : strlen($emoji_prefix);
    $separator_length = strlen($separator);

    // Reserve room for a useful one-sentence hook before trimming the title.
    $max_title = max(20, 280 - $url_length - $emoji_length - ($separator_length * 2) - 24);
    $title = sanatcin_x_trim_chars($title, $max_title);
    $title_prefix = trim($emoji_prefix . $title);

    $fixed_length = (function_exists('mb_strlen') ? mb_strlen($title_prefix, 'UTF-8') : strlen($title_prefix))
        + $url_length
        + ($separator_length * 2);
    $hook = sanatcin_x_trim_chars($hook, max(0, 280 - $fixed_length));

    $parts = array_filter([$title_prefix, $hook, $url], static fn($value) => trim((string) $value) !== '');
    $text = implode($separator, $parts);

    // Absolute raw-payload guard. This should only matter for unusually long permalinks.
    $length = function_exists('mb_strlen') ? mb_strlen($text, 'UTF-8') : strlen($text);
    if ($length > 280) {
        $max_title = max(1, $max_title - ($length - 280));
        $title_prefix = trim($emoji_prefix . sanatcin_x_trim_chars($title, $max_title));
        $parts = array_filter([$title_prefix, $hook, $url], static fn($value) => trim((string) $value) !== '');
        $text = implode($separator, $parts);
    }

    $args['text'] = $text;
    return $args;
}
add_filter('wp_to_buffer_pro_publish_build_args', 'sanatcin_buffer_x_build_args', 10, 6);

function sanatcin_buffer_x_prevent_update_duplicates($conditions_met, $status, $post, $profile_id, $service, $action) {
    if (!$conditions_met) return false;
    $network = strtolower((string) $service);
    if (!in_array($network, ['twitter', 'x'], true)) return $conditions_met;

    // A normal editorial correction must not create a second X post.
    if ($action === 'update') return false;
    return $conditions_met;
}
add_filter('wp_to_buffer_pro_publish_status_conditions_met', 'sanatcin_buffer_x_prevent_update_duplicates', 10, 6);
