/**
 * Set alpha values to 255
 * @param  {HTMLCanvasElement} canvas
 * @return {HTMLCanvasElement}
 */
function removeTransparency(canvas) {
  const ctx = canvas.getContext("2d");
  const imagedata = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imagedata.data;
  // data is [r,g,b,a, r,g,b,a, *]
  for (let i = 0; i < data.length; i += 4) {
    // usually we would have to check for alpha = 0
    // and set color to black here
    // but node-canvas already does that for us

    // remove transparency
    data[i + 3] = 255;
  }
  ctx.putImageData(imagedata, 0, 0);
  return canvas;
}


/**
 * Checks if the given canvas has any pixel that is not fully opaque
 * @param  {HTMLCanvasElement}  canvas
 * @return {Boolean}
 */
function hasTransparency(canvas) {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < imageData.length; i += 4) {
    if (imageData[i] < 255) {
      // found pixel with translucent alpha value
      return true;
    }
  }
  return false;
}

/**
 * Resize the src canvas by scale
 * @param  {HTMLCanvasElement} src
 * @param  {Number} scale
 * @return {HTMLCanvasElement}
 */
function resize(src, scale) {
  const dst = document.createElement('canvas');
  dst.width = scale * src.width;
  dst.height = scale * src.height;
  const context = dst.getContext("2d");

  // don't blur on resize
  context.imageSmoothingEnabled = false;

  context.drawImage(src, 0, 0, src.width * scale, src.height * scale);
  return dst;
}

/**
 * Get a rectangular part of the src canvas
 * @param  {HTMLImageElement} src
 * @param  {Number} x
 * @param  {Number} y
 * @param  {Number} width
 * @param  {Number} height
 * @param  {Number} scale
 * @return {HTMLCanvasElement}
 */
function getPart(src, x, y, width, height, scale) {
  const dst = document.createElement('canvas');
  dst.width = scale * width;
  dst.height = scale * height;
  const context = dst.getContext("2d");

  // don't blur on resize
  context.imageSmoothingEnabled = false;

  context.drawImage(src, x, y, width, height, 0, 0, width * scale, height * scale);
  return dst;
}

/**
 * Flip the src canvas horizontally
 * @param  {HTMLCanvasElement} src
 * @return {HTMLCanvasElement}
 */
function flip(src) {
  const dst = document.createElement('canvas');
  dst.width = src.width;
  dst.height = src.height;
  const context = dst.getContext("2d");

  context.imageSmoothingEnabled = false;

  context.scale(-1, 1);
  context.drawImage(src, -src.width, 0);
  return dst;
}

// skew for isometric perspective
const skew_a = 26 / 45;    // 0.57777777
const skew_b = skew_a * 2; // 1.15555555

/**
 * Draw skin
 * @param  {HTMLImageElement} img The image to display
 * @param  {Number} scale The scale of the skin
 * @param  {Boolean} overlay
 * @param  {Boolean} is_body
 * @param  {Boolean} slim
 * @param  {Function} callback
 */
exports.drawModel = function(img, scale, overlay, is_body, slim, callback) {
  const canvas = document.createElement('canvas');

  const dpr = window.devicePixelRatio;
  const rect = canvas.getBoundingClientRect();

  canvas.width = scale * 20;
  canvas.height = scale * (is_body ? 45.1 : 18.5);

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const skin = document.createElement('img');
  skin.src = img;
  skin.onerror = e => callback(e, null);
  skin.onload = () => {
    const old_skin = skin.height === 32;
    const arm_width = slim ? 3 : 4;

    /* eslint-disable no-multi-spaces */
    const head_top        = resize(removeTransparency(getPart(skin, 8, 0, 8, 8, 1)), scale);
    const head_front      = resize(removeTransparency(getPart(skin, 8, 8, 8, 8, 1)), scale);
    const head_right      = resize(removeTransparency(getPart(skin, 0, 8, 8, 8, 1)), scale);

    const arm_right_top   = resize(removeTransparency(getPart(skin, 44, 16, arm_width, 4, 1)), scale);
    const arm_right_front = resize(removeTransparency(getPart(skin, 44, 20, arm_width, 12, 1)), scale);
    const arm_right_side  = resize(removeTransparency(getPart(skin, 40, 20, 4, 12, 1)), scale);

    const arm_left_top    = old_skin ? flip(arm_right_top)   : resize(removeTransparency(getPart(skin, 36, 48, arm_width, 4, 1)), scale);
    const arm_left_front  = old_skin ? flip(arm_right_front) : resize(removeTransparency(getPart(skin, 36, 52, arm_width, 12, 1)), scale);

    const leg_right_front = resize(removeTransparency(getPart(skin, 4, 20, 4, 12, 1)), scale);
    const leg_right_side  = resize(removeTransparency(getPart(skin, 0, 20, 4, 12, 1)), scale);

    const leg_left_front  = old_skin ? flip(leg_right_front) : resize(removeTransparency(getPart(skin, 20, 52, 4, 12, 1)), scale);

    const body_front      = resize(removeTransparency(getPart(skin, 20, 20, 8, 12, 1)), scale);
    /* eslint-enable no-multi-spaces */

    if (overlay) {
      if (hasTransparency(getPart(skin, 32, 0, 32, 32, 1))) {
        // render head overlay
        head_top.getContext("2d").drawImage(getPart(skin, 40, 0, 8, 8, scale), 0, 0);
        head_front.getContext("2d").drawImage(getPart(skin, 40, 8, 8, 8, scale), 0, 0);
        head_right.getContext("2d").drawImage(getPart(skin, 32, 8, 8, 8, scale), 0, 0);
      }

      if (!old_skin) {
        // See #117
        // if MC-89760 gets fixed, we can (probably) simply check the whole skin for transparency

        /* eslint-disable no-multi-spaces */
        const body_region      = getPart(skin, 16, 32, 32, 16, 1);
        const right_arm_region = getPart(skin, 48, 48, 16, 16, 1);
        const left_arm_region  = getPart(skin, 40, 32, 16, 16, 1);
        const right_leg_region = getPart(skin, 0, 32, 16, 16, 1);
        const left_leg_region  = getPart(skin, 0, 48, 16, 16, 1);
        /* eslint-enable no-multi-spaces */

        if (hasTransparency(body_region)) {
          // render body overlay
          body_front.getContext("2d").drawImage(getPart(skin, 20, 36, 8, 12, scale), 0, 0);
        }

        if (hasTransparency(right_arm_region)) {
          // render right arm overlay
          arm_right_top.getContext("2d").drawImage(getPart(skin, 44, 32, arm_width, 4, scale), 0, 0);
          arm_right_front.getContext("2d").drawImage(getPart(skin, 44, 36, arm_width, 12, scale), 0, 0);
          arm_right_side.getContext("2d").drawImage(getPart(skin, 40, 36, 4, 12, scale), 0, 0);
        }

        if (hasTransparency(left_arm_region)) {
          // render left arm overlay
          arm_left_top.getContext("2d").drawImage(getPart(skin, 36 + 16, 48, arm_width, 4, scale), 0, 0);
          arm_left_front.getContext("2d").drawImage(getPart(skin, 36 + 16, 52, arm_width, 12, scale), 0, 0);
        }

        if (hasTransparency(right_leg_region)) {
          // render right leg overlay
          leg_right_front.getContext("2d").drawImage(getPart(skin, 4, 36, 4, 12, scale), 0, 0);
          leg_right_side.getContext("2d").drawImage(getPart(skin, 0, 36, 4, 12, scale), 0, 0);
        }

        if (hasTransparency(left_leg_region)) {
          // render left leg overlay
          leg_left_front.getContext("2d").drawImage(getPart(skin, 4, 52, 4, 12, scale), 0, 0);
        }
      }
    }

    let x = 0;
    let y = 0;
    let z = 0;

    const z_offset = scale * 3;
    const x_offset = scale * 2;

    if (is_body) {
      // pre-render front onto separate canvas
      const front = document.createElement('canvas');
      front.width = scale * 16;
      front.height = scale * 24;
      const frontc = front.getContext("2d");
      frontc.imageSmoothingEnabled = false;

      frontc.drawImage(arm_right_front, (4 - arm_width) * scale, 0 * scale, arm_width * scale, 12 * scale);
      frontc.drawImage(arm_left_front, 12 * scale, 0 * scale, arm_width * scale, 12 * scale);
      frontc.drawImage(body_front, 4 * scale, 0 * scale, 8 * scale, 12 * scale);
      frontc.drawImage(leg_right_front, 4 * scale, 12 * scale, 4 * scale, 12 * scale);
      frontc.drawImage(leg_left_front, 8 * scale, 12 * scale, 4 * scale, 12 * scale);


      // top
      x = x_offset + scale * 2;
      y = scale * -arm_width;
      z = z_offset + scale * 8;
      ctx.setTransform(1, -skew_a, 1, skew_a, 0, 0);
      ctx.drawImage(arm_right_top, y - z - 0.5, x + z, arm_right_top.width + 1, arm_right_top.height + 1);

      y = scale * 8;
      ctx.drawImage(arm_left_top, y - z, x + z, arm_left_top.width, arm_left_top.height + 1);

      // right side
      ctx.setTransform(1, skew_a, 0, skew_b, 0, 0);
      x = x_offset + scale * 2;
      y = 0;
      z = z_offset + scale * 20;
      ctx.drawImage(leg_right_side, x + y, z - y, leg_right_side.width, leg_right_side.height);

      x = x_offset + scale * 2;
      y = scale * -arm_width;
      z = z_offset + scale * 8;
      ctx.drawImage(arm_right_side, x + y, z - y - 0.5, arm_right_side.width, arm_right_side.height + 1);

      // front
      z = z_offset + scale * 12;
      y = 0;
      ctx.setTransform(1, -skew_a, 0, skew_b, 0, skew_a);
      ctx.drawImage(front, y + x, x + z - 0.5, front.width, front.height);
    }

    // head top
    x = x_offset;
    y = -0.5;
    z = z_offset;
    ctx.setTransform(1, -skew_a, 1, skew_a, 0, 0);
    ctx.drawImage(head_top, y - z, x + z, head_top.width, head_top.height + 1);

    // head front
    x = x_offset + 8 * scale;
    y = 0;
    z = z_offset - 0.5;
    ctx.setTransform(1, -skew_a, 0, skew_b, 0, skew_a);
    ctx.drawImage(head_front, y + x, x + z, head_front.width, head_front.height);

    // head right
    x = x_offset;
    y = 0;
    z = z_offset;
    ctx.setTransform(1, skew_a, 0, skew_b, 0, 0);
    ctx.drawImage(head_right, x + y, z - y - 0.5, head_right.width + 0.5, head_right.height + 1);

    callback(null, canvas.toDataURL());
  }
};