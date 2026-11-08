@compute @workgroup_size(256, 1, 1)
fn consumeSamples(@builtin(global_invocation_id) id: vec3u) {
  let lane = id.x;
  let count = samples.length;
  var words = 0u;
  var errors = 0u;
  for (var i = lane; i < count; i += 256u) {
    if (samples.data[i] != samples.data[0] + i) { errors++; }
    words++;
  }
  volumeState[lane] += words;
  volumeState[256u + lane] += errors;
  if (lane == 0u) {
    if (count > 0u) {
      if (volumeState[513] != 0u && samples.data[0] != volumeState[512]) { volumeState[517]++; }
      volumeState[512] = samples.data[count - 1u] + 1u;
      volumeState[513] = 1u;
      volumeState[516] += count;
      volumeState[515]++;
    }
    volumeState[514] = count;
  }
}
