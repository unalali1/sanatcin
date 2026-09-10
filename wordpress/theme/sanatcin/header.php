<!doctype html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<?php if (is_active_sidebar('top-ad')) : ?>
    <aside class="top-ad" aria-label="Reklam"><div class="site-wrap"><?php dynamic_sidebar('top-ad'); ?></div></aside>
<?php endif; ?>
<header class="brand-header">
    <div class="site-wrap brand-row">
        <a class="brand-logo" href="<?php echo esc_url(home_url('/')); ?>" aria-label="SanatÇin ana sayfa">
            <img src="<?php echo esc_url(get_template_directory_uri() . '/assets/images/logo.webp'); ?>" alt="<?php bloginfo('name'); ?>" width="423" height="220" fetchpriority="high">
        </a>
        <p class="brand-deck">Çin’in kültür ve yaşam gündemine<br>bağımsız Türkçe bakış</p>
        <div class="header-actions">
            <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="primary-navigation"><span></span><span></span><span></span><span class="screen-reader-text">Menüyü aç</span></button>
            <button class="search-toggle" type="button" aria-expanded="false" aria-controls="site-search" aria-label="Arama panelini aç">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
            </button>
        </div>
    </div>
    <div id="site-search" class="search-panel"><?php get_search_form(); ?></div>
</header>
<nav id="primary-navigation" class="main-nav" aria-label="Ana menü">
    <div class="site-wrap">
        <?php
        wp_nav_menu([
            'theme_location' => 'primary',
            'container' => false,
            'menu_class' => 'nav-list',
            'fallback_cb' => function () {
                $items = [
                    'kultur-sanat' => 'KÜLTÜR & SANAT',
                    'sinema' => 'SİNEMA',
                    'moda-tasarim' => 'MODA & TASARIM',
                    'sehir-yasam' => 'ŞEHİR & YAŞAM'
                ];
                echo '<ul class="nav-list">';
                foreach ($items as $slug => $label) {
                    $category = get_category_by_slug($slug);
                    $url = $category ? get_category_link($category) : home_url('/category/' . $slug . '/');
                    printf('<li><a href="%s">%s</a></li>', esc_url($url), esc_html($label));
                }
                echo '</ul>';
            }
        ]);
        ?>
    </div>
</nav>
<main id="content">
