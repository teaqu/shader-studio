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
 float size=0.004;float left=aspect*0.06;float right=aspect*0.53;
 float3 col=float3(0.018,0.024,0.06);float ink=0;
 ink+=label0(uv,float2(left,0.86),size*1.5);ink+=label1(uv,float2(right,0.86),size*1.5);
 ink+=label19(uv,float2(left,0.94),size);ink+=label12(uv,float2(left,0.06),size);
 float held=iChannel0.Load(int2(65,0)).r;
 float pressed=iChannel0.Load(int2(65,1)).r;
 float toggled=iChannel0.Load(int2(65,2)).r;
 ink+=label2(uv,float2(left,0.72),size);ink+=label3(uv,float2(left,0.61),size);ink+=label4(uv,float2(left,0.50),size);
 float bar=uv.x>left&&uv.x<left+aspect*0.34?1:0;
 if(uv.y>0.67&&uv.y<0.70)col+=bar*held*float3(0.1,0.7,0.9);
 if(uv.y>0.56&&uv.y<0.59)col+=bar*pressed*float3(0.1,0.7,0.9);
 if(uv.y>0.45&&uv.y<0.48)col+=bar*toggled*float3(0.1,0.7,0.9);
 ink+=label5(uv,float2(right,0.76),size);ink+=hexValue(keyState[0],uv,float2(right+0.26,0.76),size,8);
 ink+=label6(uv,float2(right,0.67),size);ink+=hexValue(keyState[1],uv,float2(right+0.26,0.67),size,8);
 ink+=label7(uv,float2(right,0.58),size);ink+=hexValue(keyState[2],uv,float2(right+0.26,0.58),size,8);
 ink+=label8(uv,float2(right,0.49),size);ink+=hexValue(keyState[3],uv,float2(right+0.26,0.49),size,8);
 ink+=label9(uv,float2(right,0.40),size);ink+=hexValue(keyState[10],uv,float2(right+0.26,0.40),size,8);
 ink+=label10(uv,float2(right,0.31),size);ink+=hexValue(keyState[7],uv,float2(right+0.26,0.31),size,8);
 ink+=label11(uv,float2(left,0.30),size);
 for(uint n=0;n<6;n++) {
   uint slot=16+((keyState[0]+15-n)%16)*4;
   ink+=hexValue(keyState[slot+1],uv,float2(left+float(n)*0.24,0.19),size,8);
   if(keyState[0]>n && uv.y>0.15&&uv.y<0.17&&uv.x>left+float(n)*0.24&&uv.x<left+float(n)*0.24+0.18)
     col+=0.4+0.4*cos(float3(0,2,4)+float(keyState[slot]));
 }
 col+=min(ink,1.0)*float3(0.72,0.89,1.0);return float4(col,1);
}
