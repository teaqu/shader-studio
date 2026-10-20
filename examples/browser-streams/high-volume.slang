// Compact GPU font data avoids large generated control-flow trees.
float letter(uint c,float2 q) {
 if(q.x<0 || q.x>=5 || q.y<0 || q.y>=7 || c>=128)return 0;
 uint bit=(uint(q.y)*5)+(4-uint(q.x));
 uint bits=fontData[c*2+(bit/32)];
 return float((bits>>(bit%32))&1);
}
float textLine(uint label,float2 uv,float2 origin,float size) {
 float2 q=(uv-origin)/size;int index=int(floor(q.x/6));
 if(index<0 || index>=32 || q.y<0 || q.y>=7)return 0;
 uint c=fontData[256+label*32+uint(index)];
 return letter(c,float2(q.x-float(index)*6,q.y));
}
float hexValue(uint value,float2 uv,float2 origin,float size,uint digits) {
 float2 q=(uv-origin)/size;int digit=int(floor(q.x/6));
 if(digit<0 || digit>=int(digits) || q.y<0 || q.y>=7)return 0;
 uint nibble=(value>>((digits-1-uint(digit))*4))&15;
 return letter(nibble<10?48+nibble:55+nibble,float2(q.x-float(digit)*6,q.y));
}
float label0(float2 uv,float2 origin,float size){return textLine(0,uv,origin,size);}
float label1(float2 uv,float2 origin,float size){return textLine(1,uv,origin,size);}
float label2(float2 uv,float2 origin,float size){return textLine(2,uv,origin,size);}
float label3(float2 uv,float2 origin,float size){return textLine(3,uv,origin,size);}
float label4(float2 uv,float2 origin,float size){return textLine(4,uv,origin,size);}
float label5(float2 uv,float2 origin,float size){return textLine(5,uv,origin,size);}
float label6(float2 uv,float2 origin,float size){return textLine(6,uv,origin,size);}
float label7(float2 uv,float2 origin,float size){return textLine(7,uv,origin,size);}
float label8(float2 uv,float2 origin,float size){return textLine(8,uv,origin,size);}
float label9(float2 uv,float2 origin,float size){return textLine(9,uv,origin,size);}
float label10(float2 uv,float2 origin,float size){return textLine(10,uv,origin,size);}
float label11(float2 uv,float2 origin,float size){return textLine(11,uv,origin,size);}
float label12(float2 uv,float2 origin,float size){return textLine(12,uv,origin,size);}
float label13(float2 uv,float2 origin,float size){return textLine(13,uv,origin,size);}
float label14(float2 uv,float2 origin,float size){return textLine(14,uv,origin,size);}
float label15(float2 uv,float2 origin,float size){return textLine(15,uv,origin,size);}
float label16(float2 uv,float2 origin,float size){return textLine(16,uv,origin,size);}
float label17(float2 uv,float2 origin,float size){return textLine(17,uv,origin,size);}
float label18(float2 uv,float2 origin,float size){return textLine(18,uv,origin,size);}
float label19(float2 uv,float2 origin,float size){return textLine(19,uv,origin,size);}
float4 mainImage(float2 fragCoord) {
 float2 uv=fragCoord/iResolution.y;float aspect=iResolution.x/iResolution.y;
 float size=0.004;float x=aspect*0.08;float ink=0;
 ink+=label13(uv,float2(x,0.88),size*1.5);ink+=label12(uv,float2(x,0.07),size);
 ink+=label14(uv,float2(x,0.72),size);ink+=hexValue(volumeState[516],uv,float2(x+0.4,0.72),size,8);
 ink+=label15(uv,float2(x,0.62),size);ink+=hexValue(uint(float(volumeState[516])*4.0/max(iTime,0.01)/1048576.0),uv,float2(x+0.4,0.62),size,8);
 ink+=label16(uv,float2(x,0.52),size);ink+=hexValue(volumeState[514],uv,float2(x+0.4,0.52),size,8);
 ink+=label17(uv,float2(x,0.42),size);ink+=hexValue(volumeState[517],uv,float2(x+0.4,0.42),size,8);
 ink+=label18(uv,float2(x,0.32),size);
 uint lane=min(255,uint(fragCoord.x/iResolution.x*256));
 float bad=float(volumeState[256+lane]>0 || volumeState[517]>0);
 float3 col=float3(0.015,0.025,0.06);
 if(uv.y>0.15&&uv.y<0.27)col=lerp(float3(0.05,0.7,0.65)*(0.4+0.6*frac(float(volumeState[lane])/8192.0)),float3(1,0.05,0.08),bad);
 col+=min(ink,1.0)*float3(0.72,0.89,1.0);return float4(col,1);
}
