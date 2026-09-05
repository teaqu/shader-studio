[shader("compute")]
[numthreads(1, 1, 1)]
void fill(uint3 id : SV_DispatchThreadID)
{
    float sum = inputs.key0.SampleLevel(float2(0.5), 0).r + inputs.key1.SampleLevel(float2(0.5), 0).r + inputs.key2.SampleLevel(float2(0.5), 0).r + inputs.key3.SampleLevel(float2(0.5), 0).r + inputs.key4.SampleLevel(float2(0.5), 0).r + inputs.key5.SampleLevel(float2(0.5), 0).r + inputs.key6.SampleLevel(float2(0.5), 0).r + inputs.key7.SampleLevel(float2(0.5), 0).r + inputs.key8.SampleLevel(float2(0.5), 0).r + inputs.key9.SampleLevel(float2(0.5), 0).r + inputs.key10.SampleLevel(float2(0.5), 0).r + inputs.key11.SampleLevel(float2(0.5), 0).r + inputs.key12.SampleLevel(float2(0.5), 0).r + inputs.key13.SampleLevel(float2(0.5), 0).r + inputs.key14.SampleLevel(float2(0.5), 0).r + inputs.key15.SampleLevel(float2(0.5), 0).r + inputs.key16.SampleLevel(float2(0.5), 0).r + inputs.key17.SampleLevel(float2(0.5), 0).r + inputs.key18.SampleLevel(float2(0.5), 0).r + inputs.key19.SampleLevel(float2(0.5), 0).r + inputs.key20.SampleLevel(float2(0.5), 0).r + inputs.key21.SampleLevel(float2(0.5), 0).r + inputs.key22.SampleLevel(float2(0.5), 0).r + inputs.key23.SampleLevel(float2(0.5), 0).r;
    writeOutput(id.xy, float4(sum, 1.0, 0.0, 1.0));
}
