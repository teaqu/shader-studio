[shader("compute")]
[numthreads(1,1,1)]
void consumeKeyboard(uint3 id : SV_DispatchThreadID) {
    uint total=keyState[0];uint repeats=keyState[1];uint textCount=keyState[2];uint scalar=keyState[3];
    uint lastSeq=keyState[9];uint errors=keyState[10];uint downs=keyState[11];uint ups=keyState[12];
    uint lastStamp=keyState[6];uint gap=keyState[7];
    uint records=min(keyboardEvents.length/8,64u);
    for (uint record=0; record<records; record++) {
        uint i=record*8;
        uint kind=keyboardEvents.data[i];
        uint cp=keyboardEvents.data[i+1];
        uint stamp=keyboardEvents.data[i+4];
        uint seq=keyboardEvents.data[i+5];
        if (total>0 && seq != lastSeq+1) errors++;
        uint slot=16+(total%16)*4;
        keyState[slot]=kind;keyState[slot+1]=cp;keyState[slot+2]=stamp;keyState[slot+3]=seq;
        total++;lastSeq=seq;
        if (kind==1) downs++;
        if (kind==2) ups++;
        if (kind==3) repeats++;
        if (kind==4) {textCount++;scalar=cp;}
        gap=lastStamp>0?stamp-lastStamp:0;
        lastStamp=stamp;
    }
    keyState[0]=total;keyState[1]=repeats;keyState[2]=textCount;keyState[3]=scalar;
    keyState[9]=lastSeq;keyState[10]=errors;keyState[11]=downs;keyState[12]=ups;
    keyState[6]=lastStamp;keyState[7]=gap;
}
