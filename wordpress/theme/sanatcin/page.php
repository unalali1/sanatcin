<?php get_header(); ?>
<?php while (have_posts()) : the_post(); ?>
<article class="content-page static-page">
    <div class="site-wrap">
        <nav class="breadcrumb" aria-label="İçerik yolu"><a href="<?php echo esc_url(home_url('/')); ?>">Ana sayfa</a><span>/</span><span><?php the_title(); ?></span></nav>
        <header class="article-header">
            <span class="eyebrow">SanatÇin</span>
            <h1><?php the_title(); ?></h1>
            <?php if (has_excerpt()) : ?><div class="article-deck"><?php the_excerpt(); ?></div><?php endif; ?>
        </header>
        <div class="article-body static-page-body"><?php the_content(); ?></div>
    </div>
</article>
<?php endwhile; ?>
<?php get_footer(); ?>
