<?php get_header(); ?>
<main id="primary" class="sc-home-main">
<?php
$dossier_home_cat = get_category_by_slug('cin-sanatlari-dosyasi');
$dossier_home_cat_id = $dossier_home_cat ? (int) $dossier_home_cat->term_id : 0;
$editor_home_cat = get_category_by_slug('editorden');
$editor_home_cat_id = $editor_home_cat ? (int) $editor_home_cat->term_id : 0;
$home_excluded_cat_ids = array_values(array_filter(array($dossier_home_cat_id, $editor_home_cat_id)));

if (!function_exists('sanatcin_home_source_timestamp')) {
  function sanatcin_home_source_timestamp($post_id) {
    $stored = get_post_meta($post_id, 'sanatcin_source_published_at', true);
    if ($stored) {
      $timestamp = strtotime($stored);
      if ($timestamp) return $timestamp;
    }
    $source_url = (string) get_post_meta($post_id, 'sanatcin_source_url', true);
    $patterns = array(
      '~/(20\d{2})(\d{2})(\d{2})(?:/|$)~',
      '~/(20\d{2})-(\d{2})-(\d{2})(?:/|$)~',
      '~/(20\d{2})-(\d{2})/(\d{2})(?:/|$)~',
      '~/a/(20\d{2})(\d{2})/(\d{2})(?:/|$)~'
    );
    foreach ($patterns as $pattern) {
      if (!preg_match($pattern, $source_url, $match)) continue;
      $timestamp = gmmktime(12, 0, 0, (int) $match[2], (int) $match[3], (int) $match[1]);
      if ($timestamp) return $timestamp;
    }
    if ($source_url !== '') return 0;
    return get_post_time('U', true, $post_id);
  }
}

if (!function_exists('sanatcin_home_identity_score')) {
  function sanatcin_home_identity_score($post_id) {
    $text = get_the_title($post_id) . ' ' . get_the_excerpt($post_id) . ' ' . get_post_meta($post_id, 'sanatcin_original_title', true);
    $text = mb_strtolower(wp_strip_all_tags($text), 'UTF-8');
    $score = 0;

    $category_slugs = wp_list_pluck(get_the_category($post_id), 'slug');
    if (in_array('kultur-sanat', $category_slugs, true)) $score += 5;
    elseif (in_array('sehir-yasam', $category_slugs, true)) $score += 3;
    elseif (in_array('sinema', $category_slugs, true)) $score += 2;
    elseif (in_array('moda-tasarim', $category_slugs, true)) $score += 1;

    $heritage_terms = array('opera','yuju','kaligraf','geleneksel','miras','zanaat','zanaatk','halk sanatı','halk sanati','arkeoloji','şiir','siir','edebiyat');
    $heritage_hits = 0;
    foreach ($heritage_terms as $term) {
      if (mb_strpos($text, $term, 0, 'UTF-8') !== false) $heritage_hits += 1;
    }
    $score += min(12, $heritage_hits * 3);

    $china_terms = array('çin','cin','pekin','beijing','suzhou','henan','guangzhou','shanghai','yunnan','xinjiang','xian');
    foreach ($china_terms as $term) {
      if (mb_strpos($text, $term, 0, 'UTF-8') !== false) {
        $score += 4;
        break;
      }
    }

    $community_terms = array('gönüllü','gonullu','topluluk','köy','koy','yerel','işçi','isci','kurye','zanaatkâr','zanaatkar');
    foreach ($community_terms as $term) {
      if (mb_strpos($text, $term, 0, 'UTF-8') !== false) {
        $score += 4;
        break;
      }
    }

    return min(25, $score);
  }
}

if (!function_exists('sanatcin_home_rank_score')) {
  function sanatcin_home_rank_score($post_id) {
    $editorial = (float) get_post_meta($post_id, 'sanatcin_score', true);
    if ($editorial <= 0) $editorial = 50;
    $identity = sanatcin_home_identity_score($post_id);
    $age_hours = max(0, (current_time('timestamp', true) - sanatcin_home_source_timestamp($post_id)) / HOUR_IN_SECONDS);
    $freshness = $age_hours <= 24 ? 12 : ($age_hours <= 48 ? 9 : ($age_hours <= 72 ? 6 : ($age_hours <= 120 ? 3 : 0)));
    $visual = 0;
    $thumb_id = get_post_thumbnail_id($post_id);
    if ($thumb_id) {
      $meta = wp_get_attachment_metadata($thumb_id);
      $width = isset($meta['width']) ? (int) $meta['width'] : 0;
      $height = isset($meta['height']) ? (int) $meta['height'] : 0;
      $ratio = $height > 0 ? $width / $height : 0;
      if ($width >= 1200) $visual += 4;
      elseif ($width >= 900) $visual += 2;
      if ($ratio >= 1.30 && $ratio <= 1.85) $visual += 4;
      elseif ($ratio >= 1.15 && $ratio <= 2.10) $visual += 2;
    }
    return $editorial + $identity + $freshness + $visual;
  }
}

if (!function_exists('sanatcin_home_image_fit_class')) {
  function sanatcin_home_image_fit_class($post_id) {
    $thumb_id = get_post_thumbnail_id($post_id);
    if (!$thumb_id) return 'sc-image-cover';
    $meta = wp_get_attachment_metadata($thumb_id);
    $width = isset($meta['width']) ? (int) $meta['width'] : 0;
    $height = isset($meta['height']) ? (int) $meta['height'] : 0;
    if (!$width || !$height) return 'sc-image-cover';
    $ratio = $width / $height;
    return ($ratio < 1.25 || $ratio > 2.20) ? 'sc-image-contain' : 'sc-image-cover';
  }
}

if (!function_exists('sanatcin_home_hero_image_id')) {
  function sanatcin_home_hero_image_id($post_id) {
    $override_id = (int) get_post_meta($post_id, 'sanatcin_hero_image_id', true);
    if ($override_id && wp_attachment_is_image($override_id)) return $override_id;
    return (int) get_post_thumbnail_id($post_id);
  }
}

if (!function_exists('sanatcin_home_hero_image_profile')) {
  function sanatcin_home_hero_image_profile($post_id) {
    $image_id = sanatcin_home_hero_image_id($post_id);
    if (!$image_id) return array('id'=>0,'eligible'=>false,'score'=>-30,'width'=>0,'height'=>0,'ratio'=>0);
    $meta = wp_get_attachment_metadata($image_id);
    $width = isset($meta['width']) ? (int) $meta['width'] : 0;
    $height = isset($meta['height']) ? (int) $meta['height'] : 0;
    $ratio = $height > 0 ? $width / $height : 0;
    $explicit = get_post_meta($post_id, 'sanatcin_hero_eligible', true);
    $crop_safe = get_post_meta($post_id, 'sanatcin_image_crop_safe', true);
    $eligible = $width >= 900 && $ratio >= 1.30 && $ratio <= 1.95;
    if ($explicit === '1') $eligible = true;
    if ($explicit === '0' || $crop_safe === '0') $eligible = false;
    $score = 0;
    if ($width >= 1600) $score += 14;
    elseif ($width >= 1400) $score += 11;
    elseif ($width >= 1200) $score += 7;
    elseif ($width >= 900) $score += 3;
    else $score -= 12;
    if ($ratio >= 1.35 && $ratio <= 1.90) $score += 12;
    elseif ($ratio >= 1.25 && $ratio <= 2.05) $score += 4;
    else $score -= 14;
    if ((int) get_post_meta($post_id, 'sanatcin_hero_image_id', true) === $image_id) $score += 4;
    return array('id'=>$image_id,'eligible'=>$eligible,'score'=>$score,'width'=>$width,'height'=>$height,'ratio'=>$ratio);
  }
}

if (!function_exists('sanatcin_home_hero_rank_score')) {
  function sanatcin_home_hero_rank_score($post_id) {
    $profile = sanatcin_home_hero_image_profile($post_id);
    return sanatcin_home_rank_score($post_id) + $profile['score'];
  }
}

if (!function_exists('sanatcin_home_title_tokens')) {
  function sanatcin_home_title_tokens($post_id) {
    $text = get_the_title($post_id) . ' ' . get_the_excerpt($post_id);
    $text = mb_strtolower(wp_strip_all_tags($text), 'UTF-8');
    $tokens = preg_split('/[^\p{L}\p{N}]+/u', $text, -1, PREG_SPLIT_NO_EMPTY);
    $stop = array('çin','çinde','çinde','yeni','ile','için','ve','bir','da','de','the','china','chinese','new','art','sanat','sergi','film');
    return array_values(array_unique(array_filter($tokens, function($token) use ($stop) {
      return mb_strlen($token, 'UTF-8') >= 4 && !in_array($token, $stop, true);
    })));
  }
}

if (!function_exists('sanatcin_home_is_topic_repeat')) {
  function sanatcin_home_is_topic_repeat($post_id, $selected_ids) {
    $tokens = sanatcin_home_title_tokens($post_id);
    if (!$tokens) return false;
    foreach ($selected_ids as $selected_id) {
      $prior = sanatcin_home_title_tokens($selected_id);
      if (!$prior) continue;
      $shared = array_intersect($tokens, $prior);
      $union = array_unique(array_merge($tokens, $prior));
      $similarity = $union ? count($shared) / count($union) : 0;
      if ($similarity >= 0.35 || count($shared) >= 3) return true;
    }
    return false;
  }
}

$pool_args = array(
  'posts_per_page' => 24,
  'post_status' => 'publish',
  'ignore_sticky_posts' => true,
  'date_query' => array(array('after' => '7 days ago'))
);
if ($home_excluded_cat_ids) $pool_args['category__not_in'] = $home_excluded_cat_ids;
$home_pool = get_posts($pool_args);
usort($home_pool, function($a, $b) {
  $delta = sanatcin_home_rank_score($b->ID) <=> sanatcin_home_rank_score($a->ID);
  if ($delta !== 0) return $delta;
  return get_post_time('U', true, $b->ID) <=> get_post_time('U', true, $a->ID);
});

$latest_home_day = '';
foreach ($home_pool as $candidate) {
  $candidate_day = gmdate('Y-m-d', sanatcin_home_source_timestamp($candidate->ID));
  if (!$latest_home_day || $candidate_day > $latest_home_day) $latest_home_day = $candidate_day;
}
if ($latest_home_day) {
  $latest_day_candidates = array_values(array_filter($home_pool, function($candidate) use ($latest_home_day) {
    return gmdate('Y-m-d', sanatcin_home_source_timestamp($candidate->ID)) === $latest_home_day;
  }));
  $hero_ready_candidates = array_values(array_filter($latest_day_candidates, function($candidate) {
    $profile = sanatcin_home_hero_image_profile($candidate->ID);
    return $profile['eligible'] === true;
  }));
  if ($hero_ready_candidates) $latest_day_candidates = $hero_ready_candidates;
  usort($latest_day_candidates, function($a, $b) {
    $delta = sanatcin_home_hero_rank_score($b->ID) <=> sanatcin_home_hero_rank_score($a->ID);
    if ($delta !== 0) return $delta;
    return sanatcin_home_source_timestamp($b->ID) <=> sanatcin_home_source_timestamp($a->ID);
  });
  $daily_hero_id = isset($latest_day_candidates[0]) ? (int) $latest_day_candidates[0]->ID : 0;
  if ($daily_hero_id) {
    foreach ($home_pool as $index => $post) {
      if ((int) $post->ID !== $daily_hero_id) continue;
      $chosen = $post;
      unset($home_pool[$index]);
      array_unshift($home_pool, $chosen);
      break;
    }
  }
}

$home_selected_ids = array();
$home_category_counts = array();
foreach ($home_pool as $candidate) {
  $candidate_id = (int) $candidate->ID;
  $categories = get_the_category($candidate_id);
  $primary_slug = $categories ? $categories[0]->slug : 'uncategorized';
  if (($home_category_counts[$primary_slug] ?? 0) >= 2) continue;
  if (sanatcin_home_is_topic_repeat($candidate_id, $home_selected_ids)) continue;
  $home_selected_ids[] = $candidate_id;
  $home_category_counts[$primary_slug] = ($home_category_counts[$primary_slug] ?? 0) + 1;
  if (count($home_selected_ids) >= 6) break;
}
if (count($home_selected_ids) < 6) {
  foreach ($home_pool as $candidate) {
    $candidate_id = (int) $candidate->ID;
    if (in_array($candidate_id, $home_selected_ids, true)) continue;
    $categories = get_the_category($candidate_id);
    $primary_slug = $categories ? $categories[0]->slug : 'uncategorized';
    if (($home_category_counts[$primary_slug] ?? 0) >= 2) continue;
    $home_selected_ids[] = $candidate_id;
    $home_category_counts[$primary_slug] = ($home_category_counts[$primary_slug] ?? 0) + 1;
    if (count($home_selected_ids) >= 6) break;
  }
}
if (count($home_selected_ids) < 6) {
  foreach ($home_pool as $candidate) {
    $candidate_id = (int) $candidate->ID;
    if (in_array($candidate_id, $home_selected_ids, true)) continue;
    $home_selected_ids[] = $candidate_id;
    if (count($home_selected_ids) >= 6) break;
  }
}

$hero_id = $home_selected_ids[0] ?? 0;
$hero = $hero_id ? new WP_Query(array('post__in'=>array($hero_id),'posts_per_page'=>1,'orderby'=>'post__in','post_status'=>'publish')) : new WP_Query(array('posts_per_page'=>1,'post_status'=>'publish'));
$home_card_ids = array_slice($home_selected_ids, 1, 5);
if ($hero->have_posts()) : while ($hero->have_posts()) : $hero->the_post(); $hero_id = get_the_ID(); ?>
<section class="sc-hero">
  <div class="sc-wrap sc-hero-grid">
    <div class="sc-hero-copy">
      <div class="entry-kicker"><?php sanatcin_post_kicker(); ?></div>
      <h2 class="sc-hero-title"><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
      <p class="sc-hero-excerpt"><?php echo esc_html(wp_trim_words(get_the_excerpt(), 28)); ?></p>
      <div class="entry-meta"><?php echo esc_html(get_the_date('j F Y')); ?></div>
    </div>
    <?php $hero_image = sanatcin_home_hero_image_profile(get_the_ID()); ?>
    <a class="sc-hero-media <?php echo $hero_image['eligible'] ? 'sc-image-cover' : esc_attr(sanatcin_home_image_fit_class(get_the_ID())); ?>" href="<?php the_permalink(); ?>">
      <?php
      if (!empty($hero_image['id'])) {
        echo wp_get_attachment_image($hero_image['id'], 'full', false, array('fetchpriority'=>'high','loading'=>'eager'));
      } elseif (has_post_thumbnail()) {
        the_post_thumbnail('large');
      } else {
        echo '<div style="height:100%;background:linear-gradient(135deg,#dfe8e9,#b9cbd0)"></div>';
      }
      ?>
    </a>
  </div>
</section>
<?php endwhile; wp_reset_postdata(); endif; ?>

<section class="sc-section">
  <div class="sc-wrap">
    <div class="sc-section-title-row">
      <h2 class="sc-section-title">Bugün SanatÇin'de</h2>
      <span class="sc-section-sub">Günün öne çıkan içerikleri</span>
    </div>
    <div class="sc-news-grid">
      <?php
      if ($home_card_ids) {
        $latest_args = array(
          'posts_per_page'=>5,
          'post_status'=>'publish',
          'post__in'=>$home_card_ids,
          'orderby'=>'post__in',
          'ignore_sticky_posts'=>true
        );
      } else {
        $latest_args = array('posts_per_page'=>5,'post_status'=>'publish','post__not_in'=>$hero_id?array($hero_id):array(),'ignore_sticky_posts'=>true);
        if ($home_excluded_cat_ids) $latest_args['category__not_in'] = $home_excluded_cat_ids;
      }
      $latest = new WP_Query($latest_args);
      if ($latest->have_posts()) : while ($latest->have_posts()) : $latest->the_post(); ?>
        <article <?php post_class('entry-card ' . sanatcin_home_image_fit_class(get_the_ID())); ?>>
          <a href="<?php the_permalink(); ?>">
            <?php if (has_post_thumbnail()) the_post_thumbnail('large'); ?>
          </a>
          <div class="entry-card-body">
            <div class="entry-kicker"><?php sanatcin_post_kicker(); ?></div>
            <h3 class="entry-title"><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
            <div class="entry-meta"><?php echo esc_html(get_the_date('j F Y')); ?></div>
          </div>
        </article>
      <?php endwhile; else: ?>
        <p>Henüz içerik bulunmuyor.</p>
      <?php endif; wp_reset_postdata(); ?>
    </div>
  </div>
</section>

<?php
$editor_cat = get_category_by_slug('editorden');
$editor_q = $editor_cat ? new WP_Query(array('cat'=>$editor_cat->term_id,'posts_per_page'=>3,'post_status'=>'publish')) : null;
?>
<section class="sc-editor-section">
  <div class="sc-wrap">
    <div class="sc-editor-strip">
      <div class="sc-editor-grid">
        <div class="sc-editor-col">
          <div class="sc-editor-label">Editörden</div>
          <h3 class="sc-editor-title">Ümran Şatana Ünal</h3>
          <p class="sc-editor-quote">Çin kültürü ve sanatına yakından, derinlikli ve özgün bir bakış.</p>
        </div>
        <?php if ($editor_q && $editor_q->have_posts()) : $i=0; while ($editor_q->have_posts()) : $editor_q->the_post(); $i++; ?>
          <div class="sc-editor-col">
            <div class="sc-editor-label"><?php echo $i===1 ? 'Son Yazı' : 'Arşivden'; ?></div>
            <h3 class="sc-editor-title"><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
            <div class="entry-meta"><?php echo esc_html(get_the_date('j F Y')); ?></div>
          </div>
        <?php endwhile; wp_reset_postdata(); endif; ?>
      </div>
    </div>
  </div>
</section>

<?php
$dossier_cat = get_category_by_slug('cin-sanatlari-dosyasi');
$dossier_status = isset($_GET['wpvibe_preview']) ? array('publish','draft') : 'publish';
$dossier_q = $dossier_cat ? new WP_Query(array(
  'cat' => $dossier_cat->term_id,
  'posts_per_page' => 4,
  'post_status' => $dossier_status,
  'orderby' => 'date',
  'order' => 'DESC'
)) : null;
if ($dossier_q && $dossier_q->have_posts()) :
  $dossier_archive_url = get_category_link($dossier_cat);
?>
<section class="sc-arts-section" aria-labelledby="sc-arts-title">
  <div class="sc-arts-shell">
    <div class="sc-arts-heading">
      <div class="sc-arts-heading-copy">
        <div class="sc-arts-overline">SanatÇin Dosyaları</div>
        <h2 id="sc-arts-title">Geleneksel Çin Sanatları</h2>
        <p>Çin'in yüzyıllar içinde biçimlenen sanat geleneklerini; tarih, teknik, malzeme ve estetik üzerinden anlatan kalıcı bir koleksiyon.</p>
      </div>
      <a class="sc-arts-all" href="<?php echo esc_url($dossier_archive_url); ?>">Koleksiyonu keşfet <span aria-hidden="true">→</span></a>
    </div>

    <?php
    $dossier_q->the_post();
    $lead_id = get_the_ID();
    $lead_url = get_permalink();
    if (get_post_status($lead_id) !== 'publish' && isset($_GET['wpvibe_preview'])) {
      $lead_url = add_query_arg(array(
        'p' => $lead_id,
        'preview' => 'true',
        'wpvibe_preview' => sanitize_text_field(wp_unslash($_GET['wpvibe_preview']))
      ), home_url('/'));
    }
    ?>
    <article class="sc-arts-feature">
      <a class="sc-arts-feature-media" href="<?php echo esc_url($lead_url); ?>">
        <?php if (has_post_thumbnail()) { the_post_thumbnail('large'); } ?>
      </a>
      <div class="sc-arts-feature-copy">
        <div class="sc-arts-badge">Çin Sanatları Dosyası</div>
        <h3><a href="<?php echo esc_url($lead_url); ?>"><?php the_title(); ?></a></h3>
        <p><?php echo esc_html(wp_trim_words(get_the_excerpt(), 34)); ?></p>
        <div class="sc-arts-feature-foot">
          <span class="entry-meta"><?php echo esc_html(get_the_date('j F Y')); ?></span>
          <a class="sc-arts-read" href="<?php echo esc_url($lead_url); ?>">Dosyayı oku <span aria-hidden="true">→</span></a>
        </div>
      </div>
    </article>

    <?php if ($dossier_q->have_posts()) : ?>
      <div class="sc-arts-more" aria-label="Diğer Çin Sanatları dosyaları">
        <?php while ($dossier_q->have_posts()) : $dossier_q->the_post();
          $item_url = get_permalink();
          if (get_post_status() !== 'publish' && isset($_GET['wpvibe_preview'])) {
            $item_url = add_query_arg(array(
              'p' => get_the_ID(),
              'preview' => 'true',
              'wpvibe_preview' => sanitize_text_field(wp_unslash($_GET['wpvibe_preview']))
            ), home_url('/'));
          }
        ?>
          <article class="sc-arts-mini">
            <a class="sc-arts-mini-media" href="<?php echo esc_url($item_url); ?>"><?php if (has_post_thumbnail()) the_post_thumbnail('medium_large'); ?></a>
            <div class="sc-arts-mini-copy">
              <div class="sc-arts-mini-kicker">Arşivden</div>
              <h4><a href="<?php echo esc_url($item_url); ?>"><?php the_title(); ?></a></h4>
            </div>
          </article>
        <?php endwhile; ?>
      </div>
    <?php else : ?>
      <div class="sc-arts-index" aria-label="Koleksiyonda ele alınacak sanatlar">
        <span>Kaligrafi</span><span>Mürekkep resmi</span><span>Porselen</span><span>Tekstil &amp; ipek</span><span>Sahne sanatları</span><span>Geleneksel zanaatlar</span>
      </div>
    <?php endif; ?>
  </div>
</section>
<?php wp_reset_postdata(); endif; ?>

<section class="sc-newsletter">
  <div class="sc-wrap sc-newsletter-grid">
    <div>
      <div class="entry-kicker" style="color:#ffe89a">Haftalık Seçki</div>
      <h2>SanatÇin Bülteni</h2>
      <p>Çin'in kültür, sanat, sinema, moda ve yaşam dünyasından görülmeye değer hikâyeler.</p>
    </div>
    <div>
      <p>Her hafta Çin'in kültür ve sanat dünyasından seçilmiş hikâyeleri almak için bültene kaydolun.</p>
      <form id="sib-form" class="sc-newsletter-form" method="POST" action="https://c2ad19f3.sibforms.com/serve/MUIFAN_BNboJQLneToEiIMtP9c44DszV0a-TCE_inJZ-3wKrncWaFwtMPPZneHMwSu2rn9EBbi7kOGwJWKMKtFqliqEWVE7ns_7OF2v9qNGh7Z5AO_WwJIPilf5dD22maJRGJDklkmRPhjDstSpbRUYHcjk-1hsvpvs3jSIoOQWcSbHiwyXCt8YCT6w23PsEo0A6-vHrenlShf9uig==" data-type="subscription">
        <input type="email" id="EMAIL" name="EMAIL" placeholder="E-posta adresiniz" aria-label="E-posta adresiniz" autocomplete="email" required>
        <input type="text" name="email_address_check" value="" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;">
        <input type="hidden" name="locale" value="tr">
        <button type="submit">Bültene Abone Ol →</button>
      </form>
    </div>
  </div>
</section>
</main>
<?php get_footer(); ?>


