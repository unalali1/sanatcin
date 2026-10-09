<?php
/**
 * Plugin Name: SanatÇin Instagram Metin Köprüsü
 * Description: Railway tarafından hazırlanan Instagram metinlerinin WordPress REST üzerinden saklanmasını ve WP to Buffer Pro'ya doğru aktarılmasını sağlar.
 * Version: 1.0.0
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * Author: SanatÇin
 * Text Domain: sanatcin-instagram-bridge
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * The live SanatÇin automation plugin can predate the separate social caption
 * field. Register it independently without replacing any existing plugin.
 * sanitize_textarea_field keeps genuine newline characters and emoji.
 */
add_action('init', function () {
    register_post_meta('post', 'sanatcin_social_instagram_text', [
        'type'              => 'string',
        'single'            => true,
        'show_in_rest'      => true,
        'sanitize_callback' => 'sanitize_textarea_field',
        'auth_callback'     => function () {
            return current_user_can('edit_posts');
        },
    ]);
}, 20);

/**
 * Set Instagram copy in the actual payload sent to Buffer Pro.
 * Do not change X, Facebook, or the WordPress site's theme or excerpts.
 */
add_filter('wp_to_buffer_pro_publish_build_args', function ($args, $post, $profile_id, $service, $status, $action) {
    if (!is_array($args) || !($post instanceof WP_Post) || $post->post_type !== 'post') {
        return $args;
    }

    if (strtolower(trim((string) $service)) !== 'instagram') {
        return $args;
    }

    $instagram_text = trim((string) get_post_meta($post->ID, 'sanatcin_social_instagram_text', true));
    if ($instagram_text !== '') {
        // Also tolerate literal \n if passed by an older worker version.
        $instagram_text = str_replace(["\\r\\n", "\\n", "\\r"], "\n", $instagram_text);
        $instagram_text = str_replace(["\r\n", "\r"], "\n", $instagram_text);
        $args['text'] = $instagram_text;
    }

    return $args;
}, 99, 6);

/**
 * An article-body correction must not queue a second Instagram post.
 * Initial publish is unaffected.
 */
add_filter('wp_to_buffer_pro_publish_status_conditions_met', function ($conditions_met, $status, $post, $profile_id, $service, $action) {
    if (!$conditions_met) {
        return $conditions_met;
    }

    if (strtolower(trim((string) $service)) === 'instagram' && (string) $action === 'update') {
        return false;
    }

    return $conditions_met;
}, 99, 6);
