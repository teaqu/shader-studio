[shader("compute")]
[numthreads(256,1,1)]
void consumeSamples(uint3 id : SV_DispatchThreadID) {
 uint lane=id.x;
 uint count=samples.length;
 uint words=0;uint errors=0;
 for(uint i=lane;i<count;i+=256) {
   if(samples.data[i] != samples.data[0]+i) errors++;
   words++;
 }
 volumeState[lane]+=words;volumeState[256+lane]+=errors;
 if(lane==0) {
   if(count>0) {
     if(volumeState[513]!=0 && samples.data[0]!=volumeState[512]) volumeState[517]++;
     volumeState[512]=samples.data[count-1]+1;volumeState[513]=1;
     volumeState[516]+=count;volumeState[515]++;
   }
   volumeState[514]=count;
 }
}
