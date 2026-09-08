<?php
/**
 * Plugin Name: SanatÇin Otomasyon Köprüsü
 * Description: Railway haber işleyicisi için kaynak alanlarını ve tekrar kontrolü REST uçlarını sağlar.
 * Version: 0.1.0
 * Requires at least: 6.5
 * Requires PHP: 8.1
 */

if (!defined('ABSPATH')) exit;

const SANATCIN_META_FIELDS = [
    'sanatcin_source_url' => 'string',
    'sanatcin_source_name' => 'string',
    'sanatcin_source_hash' => 'string',
    'sanatcin_score' => 'number',
    'sanatcin_original_title' => 'string'
];

function sanatcin_register_meta_fields() {
    foreach (SANATCIN_META_FIELDS as $key => $type) {
        register_post_meta('post', $key, [
            'type' => $type,
            'single' => true,
            'show_in_rest' => true,
            'sanitize_callback' => $type === 'number' ? 'floatval' : 'sanitize_text_field',
            'auth_callback' => function () { return current_user_can('edit_posts'); }
        ]);
    }
}
add_action('init', 'sanatcin_register_meta_fields');

function sanatcin_activate() {
    $categories = [
        'kultur-sanat' => 'Kültür & Sanat',
        'sinema' => 'Sinema',
        'moda-tasarim' => 'Moda & Tasarım',
        'sehir-yasam' => 'Şehir & Yaşam'
    ];
    foreach ($categories as $slug => $name) {
        if (!term_exists($slug, 'category')) wp_insert_term($name, 'category', ['slug' => $slug]);
    }
}
register_activation_hook(__FILE__, 'sanatcin_activate');

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

function sanatcin_register_routes() {
    register_rest_route('sanatcin/v1', '/known', [
        'methods' => 'POST',
        'callback' => 'sanatcin_known_hashes',
        'permission_callback' => function () { return current_user_can('edit_posts'); },
        'args' => ['hashes' => ['required' => true, 'type' => 'array']]
    ]);
    register_rest_route('sanatcin/v1', '/health', [
        'methods' => 'GET',
        'callback' => fn() => ['status' => 'ok', 'version' => '0.1.0', 'time' => gmdate('c')],
        'permission_callback' => '__return_true'
    ]);
}
add_action('rest_api_init', 'sanatcin_register_routes');

function sanatcin_source_box() {
    add_meta_box('sanatcin-source', 'SanatÇin Kaynak Bilgisi', function ($post) {
        $name = get_post_meta($post->ID, 'sanatcin_source_name', true);
        $url = get_post_meta($post->ID, 'sanatcin_source_url', true);
        $score = get_post_meta($post->ID, 'sanatcin_score', true);
        echo '<p><strong>Kaynak:</strong> ' . esc_html($name ?: '—') . '</p>';
        echo '<p><strong>Puan:</strong> ' . esc_html($score ?: '—') . '</p>';
        if ($url) echo '<p><a href="' . esc_url($url) . '" target="_blank" rel="noopener">Özgün haberi aç</a></p>';
    }, 'post', 'side', 'default');
}
add_action('add_meta_boxes', 'sanatcin_source_box');

