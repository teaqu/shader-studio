[shader("compute")]
[numthreads(1, 1, 1)]
void fill(uint3 id : SV_DispatchThreadID)
{
    float sum = key0.SampleLevel(float2(0.5), 0).r + key1.SampleLevel(float2(0.5), 0).r + key2.SampleLevel(float2(0.5), 0).r + key3.SampleLevel(float2(0.5), 0).r + key4.SampleLevel(float2(0.5), 0).r + key5.SampleLevel(float2(0.5), 0).r + key6.SampleLevel(float2(0.5), 0).r + key7.SampleLevel(float2(0.5), 0).r + key8.SampleLevel(float2(0.5), 0).r + key9.SampleLevel(float2(0.5), 0).r + key10.SampleLevel(float2(0.5), 0).r + key11.SampleLevel(float2(0.5), 0).r + key12.SampleLevel(float2(0.5), 0).r + key13.SampleLevel(float2(0.5), 0).r + key14.SampleLevel(float2(0.5), 0).r + key15.SampleLevel(float2(0.5), 0).r + key16.SampleLevel(float2(0.5), 0).r + key17.SampleLevel(float2(0.5), 0).r + key18.SampleLevel(float2(0.5), 0).r + key19.SampleLevel(float2(0.5), 0).r + key20.SampleLevel(float2(0.5), 0).r + key21.SampleLevel(float2(0.5), 0).r + key22.SampleLevel(float2(0.5), 0).r + key23.SampleLevel(float2(0.5), 0).r;
    writeOutput(id.xy, float4(sum, 1.0, 0.0, 1.0));
}
