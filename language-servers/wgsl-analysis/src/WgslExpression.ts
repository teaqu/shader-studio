export type WgslExpression =
  | { readonly kind: "identifier"; readonly name: string }
  | { readonly kind: "literal"; readonly text: string }
  | { readonly kind: "call"; readonly name: string; readonly callee?: string; readonly templateArguments?: readonly string[]; readonly args: readonly WgslExpression[] }
  | { readonly kind: "member"; readonly object: WgslExpression; readonly member: string }
  | { readonly kind: "index"; readonly object: WgslExpression; readonly index: WgslExpression }
  | { readonly kind: "unary"; readonly operator: string; readonly operand: WgslExpression }
  | { readonly kind: "binary"; readonly operator: string; readonly left: WgslExpression; readonly right: WgslExpression };
