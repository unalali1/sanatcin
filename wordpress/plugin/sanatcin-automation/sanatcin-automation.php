<?php
/**
 * Plugin Name: SanatÇin Otomasyon Köprüsü
 * Description: Railway haber işleyicisi için kaynak alanlarını ve tekrar kontrolü REST uçlarını sağlar.
 * Version: 0.5.0
 * Requires at least: 6.5
 * Requires PHP: 8.1
 */

if (!defined('ABSPATH')) exit;

const SANATCIN_AUTOMATION_VERSION = '0.5.0';

const SANATCIN_META_FIELDS = [
    'sanatcin_source_url' => 'string',
    'sanatcin_source_name' => 'string',
    'sanatcin_source_hash' => 'string',
    'sanatcin_image_hash' => 'string',
    'sanatcin_image_source_hash' => 'string',
    'sanatcin_image_source_url' => 'string',
    'sanatcin_image_description' => 'string',
    'sanatcin_image_origin' => 'string',
    'sanatcin_image_kind' => 'string',
    'sanatcin_ai_image_model' => 'string',
    'sanatcin_score' => 'number',
    'sanatcin_original_title' => 'string',
    'sanatcin_editorial_mode' => 'string'
];

function sanatcin_sanitize_meta_text($value) {
    return sanitize_text_field($value);
}

function sanatcin_sanitize_meta_number($value) {
    return is_numeric($value) ? (float) $value : 0.0;
}

function sanatcin_register_meta_fields() {
    foreach (SANATCIN_META_FIELDS as $key => $type) {
        register_post_meta('post', $key, [
            'type' => $type,
            'single' => true,
            'show_in_rest' => true,
            'sanitize_callback' => $type === 'number'
                ? 'sanatcin_sanitize_meta_number'
                : 'sanatcin_sanitize_meta_text',
            'auth_callback' => function () { return current_user_can('edit_posts'); }
        ]);
    }
}
add_action('init', 'sanatcin_register_meta_fields');

function sanatcin_ensure_categories() {
    $categories = [
        'kultur-sanat' => 'Kültür & Sanat',
        'sinema' => 'Sinema',
        'moda-tasarim' => 'Moda & Tasarım',
        'sehir-yasam' => 'Şehir & Yaşam',
        'editorden' => 'Editörden'
    ];
    foreach ($categories as $slug => $name) {
        if (!term_exists($slug, 'category')) wp_insert_term($name, 'category', ['slug' => $slug]);
    }
}

function sanatcin_ensure_pages() {
    $pages = [
        'hakkimizda' => ['Hakkımızda', 'SanatÇin’in yayın amacı, kapsamı ve çalışma yöntemi.'],
        'yayin-ilkeleri' => ['Yayın İlkeleri', 'SanatÇin’in doğruluk, kaynak, çeviri, yapay zekâ ve düzeltme ilkeleri.'],
        'iletisim' => ['İletişim', 'SanatÇin’e görüş, düzeltme ve içerik bildirimleri için ulaşın.']
    ];
    foreach ($pages as $slug => [$title, $excerpt]) {
        if (get_page_by_path($slug, OBJECT, 'page')) continue;
        $path = __DIR__ . '/content/' . $slug . '.html';
        $content = is_readable($path) ? file_get_contents($path) : '';
        if (!$content) continue;
        wp_insert_post([
            'post_type' => 'page',
            'post_status' => 'publish',
            'post_name' => $slug,
            'post_title' => $title,
            'post_excerpt' => $excerpt,
            'post_content' => wp_kses_post($content),
            'meta_input' => ['_sanatcin_managed_page' => '1']
        ]);
    }
}

function sanatcin_backfill_ai_image_captions() {
    $posts = get_posts([
        'post_type' => 'post',
        'post_status' => 'publish',
        'posts_per_page' => 100,
        'fields' => 'ids',
        'meta_key' => 'sanatcin_image_origin',
        'meta_value' => 'openai-generated'
    ]);
    foreach ($posts as $post_id) {
        $attachment_id = get_post_thumbnail_id($post_id);
        if (!$attachment_id) continue;
        wp_update_post([
            'ID' => $attachment_id,
            'post_excerpt' => 'AI ile üretilmiş temsili editoryal illüstrasyon.',
            'post_content' => 'Bu görsel haberin konusu için AI ile üretilmiş temsili bir editoryal illüstrasyondur.'
        ]);
    }
}

function sanatcin_activate() {
    sanatcin_ensure_categories();
    sanatcin_ensure_pages();
    sanatcin_backfill_ai_image_captions();
    update_option('sanatcin_automation_version', SANATCIN_AUTOMATION_VERSION, false);
}
register_activation_hook(__FILE__, 'sanatcin_activate');

function sanatcin_maybe_upgrade() {
    if (get_option('sanatcin_automation_version') === SANATCIN_AUTOMATION_VERSION) return;
    sanatcin_ensure_categories();
    sanatcin_ensure_pages();
    sanatcin_backfill_ai_image_captions();
    update_option('sanatcin_automation_version', SANATCIN_AUTOMATION_VERSION, false);
}
add_action('init', 'sanatcin_maybe_upgrade', 5);

function sanatcin_known_hashes(WP_REST_Request $request) {
    $hashes = array_slice(array_values(array_filter(array_map('sanitize_text_field', (array) $request->get_param('hashes')))), 0, 500);
    if (!$hashes) return new WP_REST_Response(['known' => []], 200);
    $query = new WP_Query([
        'post_type' => 'post',
        'post_status' => ['publish', 'draft', 'pending', 'future', 'private'],
        'posts_per_page' => 500,
        'fields' => 'ids',
        'meta_query' => [['key' => 'sanatcin_source_hash', 'value' => $hashes, 'compare' => 'IN']]
    ]);
    $known = array_values(array_filter(array_map(fn($id) => get_post_meta($id, 'sanatcin_source_hash', true), $query->posts)));
    return new WP_REST_Response(['known' => $known], 200);
}

function sanatcin_image_hash_known(WP_REST_Request $request) {
    $hash = sanitize_text_field((string) $request->get_param('hash'));
    $source_hash = sanitize_text_field((string) $request->get_param('source_hash'));
    if (!$hash && !$source_hash) return new WP_REST_Response(['known' => false], 200);
    $clauses = [];
    if ($hash) $clauses[] = ['key' => 'sanatcin_image_hash', 'value' => $hash];
    if ($source_hash) $clauses[] = ['key' => 'sanatcin_image_source_hash', 'value' => $source_hash];
    $query = new WP_Query([
        'post_type' => 'post',
        'post_status' => ['publish', 'draft', 'pending', 'future', 'private'],
        'posts_per_page' => 1,
        'fields' => 'ids',
        'meta_query' => array_merge(['relation' => 'OR'], $clauses)
    ]);
    return new WP_REST_Response(['known' => !empty($query->posts)], 200);
}

function sanatcin_register_routes() {
    $can_edit = function () { return current_user_can('edit_posts'); };
    register_rest_route('sanatcin/v1', '/known', [
        'methods' => 'POST',
        'callback' => 'sanatcin_known_hashes',
        'permission_callback' => $can_edit,
        'args' => ['hashes' => ['required' => true, 'type' => 'array']]
    ]);
    register_rest_route('sanatcin/v1', '/image-known', [
        'methods' => 'GET',
        'callback' => 'sanatcin_image_hash_known',
        'permission_callback' => $can_edit,
        'args' => [
            'hash' => ['required' => true, 'type' => 'string'],
            'source_hash' => ['required' => false, 'type' => 'string']
        ]
    ]);
    register_rest_route('sanatcin/v1', '/health', [
        'methods' => 'GET',
        'callback' => fn() => ['status' => 'ok', 'version' => SANATCIN_AUTOMATION_VERSION, 'time' => gmdate('c')],
        'permission_callback' => '__return_true'
    ]);
}
add_action('rest_api_init', 'sanatcin_register_routes');

function sanatcin_source_box() {
    add_meta_box('sanatcin-source', 'SanatÇin Kaynak Bilgisi', function ($post) {
        $name = get_post_meta($post->ID, 'sanatcin_source_name', true);
        $url = get_post_meta($post->ID, 'sanatcin_source_url', true);
        $score = get_post_meta($post->ID, 'sanatcin_score', true);
        $mode = get_post_meta($post->ID, 'sanatcin_editorial_mode', true);
        $image_origin = get_post_meta($post->ID, 'sanatcin_image_origin', true);
        echo '<p><strong>Kaynak:</strong> ' . esc_html($name ?: '—') . '</p>';
        echo '<p><strong>Puan:</strong> ' . esc_html($score ?: '—') . '</p>';
        echo '<p><strong>Editoryal biçim:</strong> ' . esc_html($mode ?: '—') . '</p>';
        echo '<p><strong>Görsel kökeni:</strong> ' . esc_html($image_origin ?: '—') . '</p>';
        if ($url) echo '<p><a href="' . esc_url($url) . '" target="_blank" rel="noopener">Özgün haberi aç</a></p>';
    }, 'post', 'side', 'default');
}
add_action('add_meta_boxes', 'sanatcin_source_box');
