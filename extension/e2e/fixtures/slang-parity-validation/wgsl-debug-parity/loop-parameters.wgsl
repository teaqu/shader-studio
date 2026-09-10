fn debugAccumulator(gain: f32) -> f32 {
    var accumulator = 0.0;
    for (var outer = 0; outer < 3; outer++) {
      for (var iteration = 0; iteration < 4; iteration++) {
        accumulator = accumulator + gain;
    }
    }
    return accumulator;
}

fn mainImage(coord: vec2f) -> vec4f {
    let value = debugAccumulator(0.25);
    return vec4f(value, coord.x * 0.0, 0.0, 1.0);
}
